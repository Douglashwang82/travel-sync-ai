/**
 * Cross-component signal for the trip workspace. The group chat dispatches this
 * on `window` after the AI planner's grid proposal is confirmed (a new custom
 * grid now exists); the grids rail listens and refetches so the grid appears
 * without a page reload. Same-tab only — it's a plain CustomEvent.
 */
export const GRIDS_CHANGED_EVENT = "travelsync:grids-changed";

/**
 * Native HTML5 drag-and-drop protocol for dragging an "agent-workable" chat
 * bubble onto the grids rail. The chat sets this MIME type on dragstart with a
 * JSON `ChatTaskDragPayload`; the rail reads it on drop to create the grid.
 * Document-wide, so it crosses the chat-page → fixed-rail component boundary.
 */
export const CHAT_TASK_DRAG_TYPE = "application/x-chat-task";

export interface ChatTaskDragPayload {
  messageId: string;
  agentType: string;
  title: string;
  config: Record<string, unknown>;
}

/**
 * Drag MIME type for reordering a chat bubble within the conversation. Carries
 * the dragged message id as its data. Scoped to the chat list (the grids rail
 * ignores it), so a workable bubble can carry both this and `CHAT_TASK_DRAG_TYPE`
 * — dropping on a sibling reorders, dropping on the rail creates a grid.
 */
export const CHAT_REORDER_DRAG_TYPE = "application/x-chat-reorder";

/**
 * Drag MIME type carried by *every* chat bubble (workable or not). Holds a JSON
 * `ChatBubbleDragPayload` so cross-component drop targets — notably the rail's
 * "Dispatched tasks" zone — get the message text, not just its id.
 */
export const CHAT_BUBBLE_DRAG_TYPE = "application/x-chat-bubble";

export interface ChatBubbleDragPayload {
  messageId: string;
  text: string;
}

/**
 * Fired on `window` by the grids rail after a chat bubble is successfully
 * dispatched (handed to the AI planner). The group chat listens so it can mark
 * that bubble dispatched — highlighted and no longer draggable — without a
 * round-trip. Same-tab only; it's a plain CustomEvent.
 */
export const CHAT_TASK_DISPATCHED_EVENT = "travelsync:chat-task-dispatched";

export interface ChatTaskDispatchedDetail {
  messageId: string;
}
