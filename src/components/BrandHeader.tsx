import Image from 'next/image';

/**
 * Site header. The brand guidelines place the logo top left on web, which is
 * where it sits here, unlike the slides themselves where it is top right.
 */
export function BrandHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-charcoal-line flex items-center justify-between gap-4 border-b px-5 py-3 sm:px-8">
      <div className="flex items-center gap-3">
        {/* The dark ground needs the light-tagline artwork to stay legible. */}
        <Image
          src="/brand/logo-primary.png"
          alt="Technavious"
          width={2087}
          height={281}
          priority
          className="h-6 w-auto sm:h-7"
        />
        <span className="text-muted hidden text-sm sm:inline">
          Blueprint to Benchmark for Data Centers
        </span>
      </div>
      {children}
    </header>
  );
}
