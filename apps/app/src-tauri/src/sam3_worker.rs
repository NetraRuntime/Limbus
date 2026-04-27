//! SAM3 worker thread that owns the inference context.
//!
//! `sam3::Ctx` is `!Send + !Sync`, so we pin it to a dedicated OS thread and
//! drive it through a `mpsc` channel. Each job carries a reply sender so
//! async Tauri commands can await results. The model is loaded lazily on
//! the first job so app startup stays fast.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine as _;
use image::codecs::png::{CompressionType, FilterType as PngFilterType, PngEncoder};
use image::imageops::FilterType;
use image::{ExtendedColorType, ImageEncoder, ImageReader};
use sam3::{Box as Sam3Box, Ctx, Prompt, SegmentResult};
use serde::Serialize;

/// Image side length libsam3 falls back to when the config reports 0.
/// Mirrors `src/sam3.c:sam3_set_image_file` so we produce identical pixels.
const DEFAULT_MODEL_IMAGE_SIZE: u32 = 1008;

/// One segmentation mask returned from a text-prompt segment call.
///
/// Two PNGs per mask, mirroring the C CLI's `write_overlay` fill-and-
/// outline pass:
/// - `png_base64`: alpha = 255 inside the thresholded mask, 0 outside.
///   The frontend paints this as a tinted translucent layer.
/// - `edge_png_base64`: alpha = 255 on pixels that are foreground *and*
///   have at least one 4-neighbor in the background, 0 elsewhere. The
///   frontend paints this as a solid-white 1-pixel outline stacked over
///   the fill. Both consume the default alpha channel for CSS mask-image
///   so no `mask-mode: luminance` gymnastics are needed.
#[derive(Debug, Serialize)]
pub struct SegMask {
    pub png_base64: String,
    pub edge_png_base64: String,
    pub width: u32,
    pub height: u32,
    pub score: f32,
    /// xyxy in mask coordinate space (pixels of the PNG).
    pub bbox: Option<[f32; 4]>,
}

/// Bundle returned from `SegmentText`. Empty `masks` means the text prompt
/// matched nothing after NMS.
#[derive(Debug, Serialize)]
pub struct SegmentResponse {
    pub masks: Vec<SegMask>,
    /// Width of the decoded/resized image that was fed to libsam3. Frontend
    /// uses this to scale masks to the displayed image size.
    pub source_width: u32,
    pub source_height: u32,
}

/// Jobs submitted to the worker.
pub enum Job {
    /// Encode an image from a local file path, persist the cache to disk.
    ///
    /// The path is resolved on the Tauri main thread (where AppHandle lives)
    /// from the PocketBase `{collectionId, id, file}` triple; the worker
    /// just opens it. Reading from disk keeps image bytes off the IPC wire.
    EncodeImage {
        /// PocketBase record id; used as the cache file stem.
        id: String,
        /// Absolute path to the PNG/JPEG/WebP/BMP source file.
        src_path: PathBuf,
        reply: Sender<Result<(), String>>,
    },
    /// Delete the on-disk cache for `id`. No-op if absent.
    DeleteCache {
        id: String,
        reply: Sender<Result<(), String>>,
    },
    /// Return whether an on-disk cache exists for `id`.
    CacheStatus {
        id: String,
        reply: Sender<Result<bool, String>>,
    },
    /// Force model+BPE load and reply when ready; no-op if already loaded.
    Warmup {
        reply: Sender<Result<(), String>>,
    },
    /// Set (or clear) the user-selected active model. If the path differs
    /// from the currently loaded one, the existing `Ctx` is dropped so the
    /// next job picks up the new weights — Unity-Hub-style hot swap.
    SetActiveModel {
        path: Option<PathBuf>,
        reply: Sender<Result<(), String>>,
    },
    /// Run text-prompt segmentation against an image, reuse/save the
    /// encoder cache as a side effect.
    SegmentText {
        id: String,
        src_path: PathBuf,
        text: String,
        reply: Sender<Result<SegmentResponse, String>>,
    },
    /// Run box-prompt segmentation against an image. `bbox` is
    /// `[x1, y1, x2, y2]` in **normalized** `[0, 1]` coordinates relative
    /// to the source image; the worker scales it to libsam3's prompt
    /// coordinate space (the resized image fed to `set_image_rgb`).
    SegmentBox {
        id: String,
        src_path: PathBuf,
        bbox: [f32; 4],
        reply: Sender<Result<SegmentResponse, String>>,
    },
}

/// Handle that Tauri commands use to dispatch jobs.
///
/// Cloneable so it can be held in managed state; the `Drop` on the last
/// remaining copy closes the channel and stops the worker.
#[derive(Clone)]
pub struct WorkerHandle {
    tx: Sender<Job>,
}

impl WorkerHandle {
    /// Submit an `EncodeImage` job and wait synchronously for the reply.
    ///
    /// Call from inside a `spawn_blocking` task, never from an async handler
    /// directly — this blocks the thread until the worker responds.
    pub fn encode_image_blocking(&self, id: String, src_path: PathBuf) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::EncodeImage { id, src_path, reply })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `DeleteCache` job and wait synchronously for the reply.
    pub fn delete_cache_blocking(&self, id: String) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::DeleteCache { id, reply })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `CacheStatus` job and wait synchronously for the reply.
    pub fn cache_status_blocking(&self, id: String) -> Result<bool, String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::CacheStatus { id, reply })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `Warmup` job and wait synchronously for the reply.
    pub fn warmup_blocking(&self) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::Warmup { reply })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `SetActiveModel` job and wait synchronously for the reply.
    pub fn set_active_model_blocking(&self, path: Option<PathBuf>) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::SetActiveModel { path, reply })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `SegmentText` job and wait synchronously for the reply.
    pub fn segment_text_blocking(
        &self,
        id: String,
        src_path: PathBuf,
        text: String,
    ) -> Result<SegmentResponse, String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::SegmentText {
                id,
                src_path,
                text,
                reply,
            })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }

    /// Submit a `SegmentBox` job and wait synchronously for the reply.
    ///
    /// `bbox` is `[x1, y1, x2, y2]` in normalized `[0, 1]` coordinates.
    pub fn segment_box_blocking(
        &self,
        id: String,
        src_path: PathBuf,
        bbox: [f32; 4],
    ) -> Result<SegmentResponse, String> {
        let (reply, rx) = mpsc::channel();
        self.tx
            .send(Job::SegmentBox {
                id,
                src_path,
                bbox,
                reply,
            })
            .map_err(|_| "sam3 worker is not running".to_string())?;
        rx.recv()
            .map_err(|_| "sam3 worker dropped reply".to_string())?
    }
}

/// Model discovery strategy. Filled in at startup, consumed lazily on the
/// worker thread when the first job needs the model.
struct ModelConfig {
    /// First path that resolves wins; `None` entries are skipped.
    candidates: Vec<Option<PathBuf>>,
    /// BPE vocab (bundled as a Tauri resource). Optional — if missing we
    /// still serve image jobs, but text prompts will fail later.
    bpe_path: Option<PathBuf>,
    /// Where to write `.sam3cache` files, one per image id.
    cache_dir: PathBuf,
}

/// Spawn the worker thread. Returns a handle you can store in managed state.
///
/// `model_candidates` is tried in order on first use. The first existing
/// file is loaded. If none exist, jobs that require the model return a
/// readable error.
pub fn spawn(
    model_candidates: Vec<Option<PathBuf>>,
    bpe_path: Option<PathBuf>,
    cache_dir: PathBuf,
) -> WorkerHandle {
    let (tx, rx) = mpsc::channel::<Job>();
    let cfg = ModelConfig {
        candidates: model_candidates,
        bpe_path,
        cache_dir,
    };
    // libsam3's image encoder allocates large on-stack scratch buffers;
    // macOS pthread's ~512 KB default blows out. Give the worker a
    // generous 64 MB stack so new layers don't reintroduce overflows.
    thread::Builder::new()
        .name("sam3-worker".into())
        .stack_size(64 * 1024 * 1024)
        .spawn(move || run(rx, cfg))
        .expect("spawn sam3-worker thread");
    WorkerHandle { tx }
}

/// Worker event loop. Owns the `Ctx` once the first model-bearing job
/// arrives; stays idle (holding nothing) until then.
fn run(rx: Receiver<Job>, cfg: ModelConfig) {
    if let Err(err) = fs::create_dir_all(&cfg.cache_dir) {
        eprintln!(
            "[sam3] failed to create cache dir {}: {err}",
            cfg.cache_dir.display()
        );
    }

    let mut ctx: Option<Ctx> = None;
    // Path of the model currently materialized in `ctx`. We compare against
    // the `cfg.active` override before each ensure_ctx so a Unity-Hub style
    // model swap drops the old Ctx automatically.
    let mut loaded_path: Option<PathBuf> = None;
    let mut active_override: Option<PathBuf> = None;
    // Image ids whose features are already populated in the live Ctx's image
    // cache. Used to skip redundant cache_load_image / claim_slot calls that
    // would otherwise duplicate or evict slots on every visit. Reset whenever
    // the Ctx is dropped (model swap) so a fresh Ctx starts from empty.
    let mut in_memory_loaded: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    while let Ok(job) = rx.recv() {
        match job {
            Job::EncodeImage { id, src_path, reply } => {
                let res = ensure_ctx(&mut ctx, &mut loaded_path, &active_override, &cfg)
                    .and_then(|ctx| encode_and_persist(ctx, &cfg.cache_dir, &id, &src_path));
                if res.is_ok() {
                    in_memory_loaded.insert(id.clone());
                }
                let _ = reply.send(res);
            }
            Job::DeleteCache { id, reply } => {
                in_memory_loaded.remove(&id);
                let _ = reply.send(delete_cache(&cfg.cache_dir, &id));
            }
            Job::CacheStatus { id, reply } => {
                let _ = reply.send(Ok(cache_path(&cfg.cache_dir, &id).exists()));
            }
            Job::Warmup { reply } => {
                let res = ensure_ctx(&mut ctx, &mut loaded_path, &active_override, &cfg)
                    .map(|_| ());
                let _ = reply.send(res);
            }
            Job::SetActiveModel { path, reply } => {
                if path != active_override {
                    active_override = path;
                    // Drop ctx if the new override would resolve to a
                    // different file than what's currently loaded.
                    if let Some(loaded) = loaded_path.as_ref() {
                        let next = active_override
                            .clone()
                            .or_else(|| pick_default(&cfg));
                        let differs = match next {
                            Some(p) => &p != loaded,
                            None => true,
                        };
                        if differs {
                            ctx = None;
                            loaded_path = None;
                            in_memory_loaded.clear();
                        }
                    }
                }
                let _ = reply.send(Ok(()));
            }
            Job::SegmentText {
                id,
                src_path,
                text,
                reply,
            } => {
                let res = ensure_ctx(&mut ctx, &mut loaded_path, &active_override, &cfg)
                    .and_then(|ctx| {
                        segment_text(
                            ctx,
                            &cfg.cache_dir,
                            &id,
                            &src_path,
                            &text,
                            &mut in_memory_loaded,
                        )
                    });
                let _ = reply.send(res);
            }
            Job::SegmentBox {
                id,
                src_path,
                bbox,
                reply,
            } => {
                let res = ensure_ctx(&mut ctx, &mut loaded_path, &active_override, &cfg)
                    .and_then(|ctx| {
                        segment_box(
                            ctx,
                            &cfg.cache_dir,
                            &id,
                            &src_path,
                            bbox,
                            &mut in_memory_loaded,
                        )
                    });
                let _ = reply.send(res);
            }
        }
    }
}

fn pick_default(cfg: &ModelConfig) -> Option<PathBuf> {
    cfg.candidates.iter().flatten().find(|p| p.exists()).cloned()
}

/// Prepare the context for segmentation against `src_path`. Loads the
/// on-disk cache if present, otherwise encodes + saves. Returns the
/// resized (width, height) that was fed to libsam3.
fn ensure_image_loaded(
    ctx: &mut Ctx,
    cache_dir: &Path,
    id: &str,
    src_path: &Path,
    in_memory_loaded: &mut std::collections::HashSet<String>,
) -> Result<(u32, u32), String> {
    let target = match ctx.image_size() {
        0 => DEFAULT_MODEL_IMAGE_SIZE,
        n => n,
    };
    let dst = cache_path(cache_dir, id);
    let (pixels, width, height) = decode_and_resize(src_path, target)?;

    // Best-effort: pull persisted encoder cache into memory. A stale cache
    // (model mismatch, schema change) returns an error we ignore — the
    // subsequent precache will just re-encode.
    //
    // Skip the disk-load when we've already loaded this id into the Ctx during
    // this session. Re-running cache_load_image claims a fresh image-cache slot
    // every call, which (a) duplicates a slot already in cache and (b) can
    // evict an unrelated image's slot via LRU. Once an id is in-memory the
    // subsequent precache_image hits the existing slot and no disk reload is
    // needed.
    if dst.exists() && !in_memory_loaded.contains(id) {
        match ctx.cache_load_image(&dst) {
            Ok(()) => {
                in_memory_loaded.insert(id.to_string());
            }
            Err(e) => {
                eprintln!(
                    "[sam3] cache_load_image {} failed ({e}) — re-encoding",
                    dst.display()
                );
            }
        }
    }

    ctx.precache_image(&pixels, width, height)
        .map_err(|e| format!("precache_image: {e}"))?;
    in_memory_loaded.insert(id.to_string());

    if !dst.exists() {
        let tmp = dst.with_extension("sam3cache.tmp");
        ctx.cache_save_image(&pixels, width, height, &tmp)
            .map_err(|e| format!("cache_save_image: {e}"))?;
        fs::rename(&tmp, &dst)
            .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), dst.display()))?;
    }

    ctx.set_image_rgb(&pixels, width, height)
        .map_err(|e| format!("set_image_rgb: {e}"))?;

    Ok((width, height))
}

fn segment_text(
    ctx: &mut Ctx,
    cache_dir: &Path,
    id: &str,
    src_path: &Path,
    text: &str,
    in_memory_loaded: &mut std::collections::HashSet<String>,
) -> Result<SegmentResponse, String> {
    let (src_w, src_h) =
        ensure_image_loaded(ctx, cache_dir, id, src_path, in_memory_loaded)?;
    let result = ctx
        .segment(&[Prompt::Text(text)])
        .map_err(|e| format!("segment: {e}"))?;
    // Match libsam3 CLI default `nms_prob_thresh = 0.5`. The full SAM3 model
    // can return best IoU around 0.4–0.6, so 0.3 keeps reasonable detections
    // visible while still filtering obvious noise. 0.8 was too aggressive
    // and dropped every candidate on cat_1.jpeg/"cat" (best IoU = 0.46).
    build_segment_response(result, src_w, src_h, 0.3)
}

/// Run a single box prompt. `bbox` is normalized `[x1, y1, x2, y2]` in `[0, 1]`
/// relative to the source image; the caller validates that range. Here we scale
/// to the image coordinate space libsam3 actually sees (the `src_w × src_h`
/// dimensions returned by `ensure_image_loaded`).
fn segment_box(
    ctx: &mut Ctx,
    cache_dir: &Path,
    id: &str,
    src_path: &Path,
    bbox: [f32; 4],
    in_memory_loaded: &mut std::collections::HashSet<String>,
) -> Result<SegmentResponse, String> {
    let (src_w, src_h) =
        ensure_image_loaded(ctx, cache_dir, id, src_path, in_memory_loaded)?;
    let w = src_w as f32;
    let h = src_h as f32;
    let box_prompt = Sam3Box {
        x1: bbox[0] * w,
        y1: bbox[1] * h,
        x2: bbox[2] * w,
        y2: bbox[3] * h,
    };
    let result = ctx
        .segment(&[Prompt::Box(box_prompt)])
        .map_err(|e| format!("segment: {e}"))?;
    // After the upstream prompt-encoder fix (vendor/sam3.c 894dc93) libsam3
    // scores box-prompt candidates correctly, so NMS + score filtering work
    // the same way as text prompts. Use 0.3 (see segment_text comment).
    build_segment_response(result, src_w, src_h, 0.3)
}

/// Reduce (NMS), sort best-first, PNG-encode masks, and bundle with the
/// source dimensions the frontend uses for placement. Shared between text
/// prompts and any future N-mask variant.
///
/// `score_thresh` is the IoU-score cutoff applied BEFORE NMS — masks
/// whose per-mask score is below this are dropped. Not to be confused
/// with `min_quality` (the post-NMS stability filter), which we leave
/// disabled (0.0, matching libsam3's CLI default).
fn build_segment_response(
    result: SegmentResult,
    src_w: u32,
    src_h: u32,
    score_thresh: f32,
) -> Result<SegmentResponse, String> {
    let reduced = if result.iou_valid() && result.n_masks() > 0 {
        result.nms(score_thresh, 0.5, 0.0).unwrap_or(result)
    } else {
        result
    };

    // Sort masks best-first by IoU score so the frontend renders the
    // highest-confidence detections on top. NMS has already filtered
    // overlapping duplicates upstream; anything that makes it here is a
    // distinct detection worth returning.
    let mut order: Vec<usize> = (0..reduced.n_masks()).collect();
    order.sort_by(|a, b| {
        reduced
            .iou_scores()
            .get(*b)
            .copied()
            .unwrap_or(0.0)
            .partial_cmp(&reduced.iou_scores().get(*a).copied().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mask_w = reduced.mask_width() as u32;
    let mask_h = reduced.mask_height() as u32;
    let mut masks = Vec::with_capacity(order.len());
    let boxes = reduced.boxes().map(<[[f32; 4]]>::to_vec);
    let scores: Vec<f32> = reduced.iou_scores().to_vec();

    for &i in &order {
        let slice = match reduced.mask(i) {
            Some(s) => s,
            None => continue,
        };
        let (png_base64, edge_png_base64) = encode_mask_pngs(slice, mask_w, mask_h)?;
        masks.push(SegMask {
            png_base64,
            edge_png_base64,
            width: mask_w,
            height: mask_h,
            score: scores.get(i).copied().unwrap_or(0.0),
            bbox: boxes.as_ref().and_then(|b| b.get(i).copied()),
        });
    }

    Ok(SegmentResponse {
        masks,
        source_width: src_w,
        source_height: src_h,
    })
}


/// PNG-encode mask logits as two separate alpha-mask PNGs, matching
/// the CLI `write_overlay` fill-and-outline pass exactly.
///
/// Returns `(fill_base64, edge_base64)`:
/// - **Fill PNG:** alpha = 255 where logit > 0 (foreground), 0 else.
///   Frontend paints through a tinted translucent div.
/// - **Edge PNG:** alpha = 255 on foreground pixels with any 4-neighbor
///   in the background (the CLI's edge rule verbatim), 0 elsewhere.
///   Frontend paints through a solid-white div stacked over the fill.
///
/// Both PNGs drive the default alpha channel for CSS `mask-image` — no
/// `mask-mode: luminance` gymnastics. Base64 transport keeps the payload
/// compact vs. Vec<u8> (which serializes as a JSON number array).
fn encode_mask_pngs(
    logits: &[f32],
    width: u32,
    height: u32,
) -> Result<(String, String), String> {
    let w = width as usize;
    let h = height as usize;
    let n = w
        .checked_mul(h)
        .ok_or_else(|| "mask dims overflow".to_string())?;
    if logits.len() < n {
        return Err(format!("mask shorter than {width}x{height}"));
    }
    let mut fill = Vec::with_capacity(n * 2);
    let mut edge = Vec::with_capacity(n * 2);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let fg = logits[i] > 0.0;
            let is_edge = fg
                && (x == 0
                    || logits[i - 1] <= 0.0
                    || x == w - 1
                    || logits[i + 1] <= 0.0
                    || y == 0
                    || logits[i - w] <= 0.0
                    || y == h - 1
                    || logits[i + w] <= 0.0);
            let fa = if fg { 255u8 } else { 0u8 };
            let ea = if is_edge { 255u8 } else { 0u8 };
            fill.push(fa);
            fill.push(fa);
            edge.push(ea);
            edge.push(ea);
        }
    }
    Ok((
        encode_la8_png(&fill, width, height)?,
        encode_la8_png(&edge, width, height)?,
    ))
}

fn encode_la8_png(la: &[u8], width: u32, height: u32) -> Result<String, String> {
    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        &mut png_bytes,
        CompressionType::Default,
        PngFilterType::Adaptive,
    );
    encoder
        .write_image(la, width, height, ExtendedColorType::La8)
        .map_err(|e| format!("png encode: {e}"))?;

    Ok(STANDARD_NO_PAD.encode(&png_bytes))
}

fn ensure_ctx<'a>(
    ctx: &'a mut Option<Ctx>,
    loaded_path: &mut Option<PathBuf>,
    active_override: &Option<PathBuf>,
    cfg: &ModelConfig,
) -> Result<&'a mut Ctx, String> {
    if ctx.is_none() {
        // The user-selected override wins; fall back to the auto-discovered
        // candidate list only when nothing has been pinned.
        let model_path = active_override
            .clone()
            .filter(|p| p.exists())
            .or_else(|| pick_default(cfg))
            .ok_or_else(|| {
                "no SAM3 model installed — open Settings → Models and \
                 download one before opening a project"
                    .to_string()
            })?;

        eprintln!("[sam3] loading model: {}", model_path.display());
        // n_image_slots=64 (vs default 8) so a typical project's image set
        // fits in cache without LRU eviction. budget=0 (via new_with_cache)
        // disables disk spilling — slots stay resident in RAM. Without this,
        // demote-to-disk write failures (`image_cache: demote write failed`)
        // silently drop encoded features, forcing re-encodes on subsequent
        // visits and producing degraded masks under cycling workloads.
        let mut c = Ctx::new_with_cache(64, 64)
            .map_err(|e| format!("sam3 init: {e}"))?;
        c.load_model(&model_path)
            .map_err(|e| format!("sam3 load_model {}: {e}", model_path.display()))?;

        // libsam3's load_model auto-discovers `bpe_simple_vocab_16e6.txt.gz`
        // next to the weight file and refuses a second load with EINVAL
        // (tokenizer.c:658). Only fall back to the bundled BPE when the
        // model directory is missing it — e.g. user-placed .sam3 without
        // the co-located vocab.
        let auto_discovered = model_path
            .parent()
            .map(|d| d.join("bpe_simple_vocab_16e6.txt.gz").exists())
            .unwrap_or(false);
        if !auto_discovered {
            if let Some(bpe) = cfg.bpe_path.as_ref().filter(|p| p.exists()) {
                match c.load_bpe(bpe) {
                    Ok(()) => eprintln!("[sam3] loaded bundled BPE: {}", bpe.display()),
                    Err(e) => eprintln!(
                        "[sam3] load_bpe {} failed: {e} (text prompts disabled)",
                        bpe.display()
                    ),
                }
            } else {
                eprintln!(
                    "[sam3] no BPE vocab co-located with model and no bundled fallback \
                     available — text prompts will use byte-level fallback"
                );
            }
        }

        *ctx = Some(c);
        *loaded_path = Some(model_path);
    }
    Ok(ctx.as_mut().expect("ctx initialized above"))
}

fn encode_and_persist(
    ctx: &mut Ctx,
    cache_dir: &Path,
    id: &str,
    src_path: &Path,
) -> Result<(), String> {
    if cache_path(cache_dir, id).exists() {
        return Ok(());
    }
    let target = match ctx.image_size() {
        0 => DEFAULT_MODEL_IMAGE_SIZE,
        n => n,
    };
    let (pixels, width, height) = decode_and_resize(src_path, target)?;
    ctx.precache_image(&pixels, width, height)
        .map_err(|e| format!("precache_image: {e}"))?;

    let dst = cache_path(cache_dir, id);
    let tmp = dst.with_extension("sam3cache.tmp");
    ctx.cache_save_image(&pixels, width, height, &tmp)
        .map_err(|e| format!("cache_save_image: {e}"))?;
    // Atomic rename within the same directory so a crash mid-write can't
    // leave a half-written .sam3cache that later fails the model-signature
    // check on load.
    fs::rename(&tmp, &dst)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), dst.display()))?;
    Ok(())
}

/// Decode a source image file and bilinear-squash to `target × target`, the
/// same transform libsam3's `sam3_set_image_file` applies before encoding.
/// Cache keys are derived from the pixel buffer, so the resize parameters
/// must stay lockstep with libsam3.
fn decode_and_resize(path: &Path, target: u32) -> Result<(Vec<u8>, u32, u32), String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?
        .with_guessed_format()
        .map_err(|e| format!("image format detect: {e}"))?;
    let img = reader.decode().map_err(|e| format!("image decode: {e}"))?;
    let resized = img.resize_exact(target, target, FilterType::Triangle);
    let rgb = resized.to_rgb8();
    let (w, h) = rgb.dimensions();
    Ok((rgb.into_raw(), w, h))
}

fn delete_cache(cache_dir: &Path, id: &str) -> Result<(), String> {
    let p = cache_path(cache_dir, id);
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", p.display())),
    }
}

fn cache_path(cache_dir: &Path, id: &str) -> PathBuf {
    // PocketBase record ids are [a-z0-9]{15} — no path-traversal risk, but
    // defensive sanitisation is cheap.
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    cache_dir.join(format!("{safe}.sam3cache"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_path_strips_traversal() {
        let dir = PathBuf::from("/tmp/cache");
        assert_eq!(cache_path(&dir, "abc123"), dir.join("abc123.sam3cache"));
        assert_eq!(cache_path(&dir, "../evil"), dir.join("evil.sam3cache"));
        assert_eq!(cache_path(&dir, "a/b/c"), dir.join("abc.sam3cache"));
    }

    #[test]
    fn delete_cache_missing_file_is_ok() {
        let tmp = std::env::temp_dir().join(format!("sam3_test_{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        assert!(delete_cache(&tmp, "doesnotexist").is_ok());
        fs::remove_dir_all(&tmp).ok();
    }
}
