import type { FeedbackRequestDoc, GameDoc, GameInfoDoc, UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";

declare global {
	namespace Application {
		export interface DefaultState {
			user?: WithId<UserDoc>;
			// Set when the request was authenticated with an admin token (issue #105)
			// rather than a session/JWT — used to block session-only routes.
			adminToken?: true;

			game?: GameDoc;
			foundUser?: WithId<UserDoc>;
			foundBoardgame?: GameInfoDoc;
			foundFeedbackRequest?: WithId<FeedbackRequestDoc>;
			ip: string;
			requestId: string;
		}
	}
}

// declare module "koa" {
//   interface Context {

//   }
// }
