import type { RepoIdentifier, RepoMetadata, Result } from "./types";

export type ExtensionMessage =
  | { type: "GET_PRIVATE_STAR_STATUS"; repo: string }
  | { type: "TOGGLE_PRIVATE_STAR"; repo: RepoIdentifier }
  | { type: "GET_PRIVATE_STARS"; viewerLogin: string }
  | { type: "REMOVE_PRIVATE_STAR"; repo: string; viewerLogin: string }
  | { type: "TEST_CONNECTION" }
  | { type: "OPEN_OPTIONS" };

export interface MessageResponseMap {
  GET_PRIVATE_STAR_STATUS: Result<{ starred: boolean }>;
  TOGGLE_PRIVATE_STAR: Result<{ starred: boolean }>;
  GET_PRIVATE_STARS: Result<{ stars: RepoMetadata[] }>;
  REMOVE_PRIVATE_STAR: Result<{ removed: true }>;
  TEST_CONNECTION: Result<{ message: string }>;
  OPEN_OPTIONS: Result<{ opened: true }>;
}

export type ResponseFor<M extends ExtensionMessage> = MessageResponseMap[M["type"]];

export function sendExtensionMessage<M extends ExtensionMessage>(
  message: M
): Promise<ResponseFor<M>> {
  return chrome.runtime.sendMessage(message) as Promise<ResponseFor<M>>;
}
