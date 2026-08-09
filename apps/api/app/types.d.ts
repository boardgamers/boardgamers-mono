import type { GameDoc, GameInfoDoc, UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";

declare global {
	namespace Application {
		export interface DefaultState {
			user?: WithId<UserDoc>;
			// Set when the request was authenticated with an admin token (issue #105)
			// rather than a session/JWT — used to block session-only routes.
			adminToken?: true;
			// Set by the signout route after clearing the forum SSO cookie, so the
			// post-response middleware doesn't re-clear it (issue #152).
			forumSsoCookieCleared?: true;
			game?: GameDoc;
			foundUser?: WithId<UserDoc>;
			foundBoardgame?: GameInfoDoc;
			ip: string;
			requestId: string;
		}
	}
}

// declare module "koa" {
//   interface Context {

//   }
// }
