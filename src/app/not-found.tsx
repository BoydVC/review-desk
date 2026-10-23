import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-4xl">That review is not on the desk.</h1>
      <p className="text-muted-foreground">The id does not match a seeded example or an imported pull.</p>
      <Link href="/" className="underline">
        Back to the desk
      </Link>
    </div>
  );
}
