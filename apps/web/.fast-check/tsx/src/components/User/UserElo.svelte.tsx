///<reference types="svelte" />
;
import { gameInfo, loadGameInfo } from "@/lib/game-info.svelte";
import { get } from "@/lib/api";
import { handleError, pluralize } from "@/utils";
import type { GamePreferences } from "@bgs/models";
import infoCircleFill from "@iconify/icons-bi/info-circle-fill.js";
import { Icon } from "@/modules/cdk";
function $$render() {

  
  
  
  
  
  

   let userId: string/*Ωignore_startΩ*/;userId = __sveltets_2_any(userId);/*Ωignore_endΩ*/;

  let gamePreferences: GamePreferences[] = [];

  const onUserIdChanged = () =>
    get<GamePreferences[]>(`/user/${userId}/games/elo`)
      .then((prefs) => (gamePreferences = prefs))
      .catch(handleError);

  ;() => {$: (onUserIdChanged(), [userId]);}

  async function gameName(game: string): Promise<string> {
    const info = gameInfo(game, "latest");

    if (!info) {
      return loadGameInfo(game, "latest").then(
        () => gameName(game),
        (err: Error) => {
          handleError(err);
          return "error";
        }
      );
    }

    return info.label;
  }
;
async () => {

if(gamePreferences.some((pref) => pref.elo)){
   { svelteHTML.createElement("div", {});
     { svelteHTML.createElement("h3", { "class":`card-title`,});
        { svelteHTML.createElement("a", { "href":`/page/elo`,}); { const $$_nocI3C = __sveltets_2_ensureComponent(Icon); new $$_nocI3C({ target: __sveltets_2_any(), props: {      "icon":infoCircleFill,"class":`text-secondary small`,"inline":true,}});} }
     }
     { svelteHTML.createElement("ul", { "class":`list-group text-start`,});
        for(let gamePref of __sveltets_2_ensureArray(gamePreferences.filter((pref) => !!pref.elo))){
         { svelteHTML.createElement("div", { "class":`list-group-item list-group-item-action py-2`,});
           { svelteHTML.createElement("span", {});
               { const $$_value = await (gameName(gamePref.game));{ const name = $$_value; 
              name;   { svelteHTML.createElement("b", {});gamePref.elo.value; } 
              pluralize(gamePref.elo.games, "game");
            }}
           }
         }
      }
     }
   }
}
};
return { props: {userId: userId} as {userId: string}, exports: {}, bindings: "", slots: {}, events: {} }}
const UserElo__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type UserElo__SvelteComponent_ = InstanceType<typeof UserElo__SvelteComponent_>;
/*Ωignore_endΩ*/export default UserElo__SvelteComponent_;