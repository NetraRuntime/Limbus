import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import { Header } from './Header';
import { Hero } from './Hero';
import { Why } from './Why';
import { Waitlist } from './Waitlist';
import { Footer } from './Footer';

export function Landing() {
  useRevealOnScroll();
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Why />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
