import { createAdvancedWorkerHandler } from "./advancedRuntime";
import type { WorkerReply } from "./advancedProtocol";

const scope = globalThis as unknown as {
  postMessage: (value: WorkerReply) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const handle = createAdvancedWorkerHandler((reply) => scope.postMessage(reply));
scope.onmessage = (event) => {
  void handle(event.data);
};
