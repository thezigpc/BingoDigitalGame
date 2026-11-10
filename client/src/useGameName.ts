import { useEffect, useState } from "react";
import { DEFAULT_GAME_NAME } from "@bingo/shared";
import { serverUrl } from "./socket";

let cached: string | null = null;

/** Deployment's display name (GAME_NAME env on the server). */
export function useGameName(): string {
  const [name, setName] = useState(cached ?? DEFAULT_GAME_NAME);
  useEffect(() => {
    if (cached) return;
    fetch(`${serverUrl}/api/config`)
      .then((r) => r.json())
      .then((c: { gameName?: string }) => {
        cached = c.gameName || DEFAULT_GAME_NAME;
        document.title = cached;
        setName(cached);
      })
      .catch(() => {});
  }, []);
  return name;
}
