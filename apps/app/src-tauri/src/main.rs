#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--self-check") {
        netrart_lib::run_self_check();
    }
    netrart_lib::run()
}
