import React from "react";
import { cn } from "../lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-zinc-800", className)}
      {...props}
    />
  );
}

export function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
          <div className="flex justify-between items-start">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}
