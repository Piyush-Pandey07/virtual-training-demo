import Image from 'next/image';
import Link from 'next/link';

/**
 * Site header. The brand guidelines place the logo top left on web, which is
 * where it sits here, unlike the slides themselves where it is top right.
 */
export function BrandHeader({ children }: { children?: React.ReactNode }) {
  return (
    // Wraps rather than overflows. `justify-between` on a row that cannot fit does not
    // shrink anything -- it lets the contents run past each other, and on a phone the
    // first nav link ends up printed across the logo. Dropping the links to a second
    // line is the honest way to run out of width.
    <header className="border-charcoal-line flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3 sm:px-8">
      <div className="flex items-center gap-3">
        {/* Home, because that is what a logo in this position means everywhere else.
            It is a link on every page including the index, where it is a harmless
            no-op, rather than something that appears and disappears. */}
        <Link
          href="/"
          aria-label="Technavious home"
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          {/* The dark ground needs the light-tagline artwork to stay legible. */}
          <Image
            src="/brand/logo-primary.png"
            alt="Technavious"
            width={2087}
            height={281}
            priority
            className="h-6 w-auto sm:h-7"
          />
        </Link>
        <span className="text-muted hidden text-sm sm:inline">
          Blueprint to Benchmark for Data Centers
        </span>
      </div>
      {children}
    </header>
  );
}
