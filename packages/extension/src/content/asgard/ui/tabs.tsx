// shadcn Tabs — Radix Tabs (renders inline, no portal → shadow-safe). Copied in.
import type { JSX } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>): JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex h-9 w-full items-center gap-1 rounded-md border border-border bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border border-transparent px-2.5 text-xs font-medium transition-[color,background-color,border-color] duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:size-3.5 hover:text-foreground data-[state=inactive]:hover:border-border/60 data-[state=inactive]:hover:bg-card/50 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>): JSX.Element {
  return (
    <TabsPrimitive.Content
      className={cn(
        "flex-1 overflow-hidden focus-visible:outline-none motion-safe:[animation:prw-tab-in_150ms_ease-out]",
        className,
      )}
      {...props}
    />
  );
}
