"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-4xl">The desk could not open.</h1>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button type="button" onClick={reset} className="w-fit underline">
        Try again
      </button>
    </div>
  );
}
