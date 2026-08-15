// The viewer↔game debug-info protocol. The site's "copy debug info" FAB posts
// `requestDebugInfo` to the game iframe; a viewer implementing the protocol answers
// with `debugInfo`, whose payload shape is entirely up to the game's viewer.
export const DEBUG_INFO_REQUEST = "requestDebugInfo";
export const DEBUG_INFO_MESSAGE = "debugInfo";
