///<reference types="svelte" />
;
import { timerTime, defer, duration, niceDate, shortDuration } from "@/utils";
import type { IGame } from "@bgs/models";
import { createWatcher } from "@/utils/watch";
import clockHistory from "@iconify/icons-bi/clock-history.js";
import { Badge, Icon, Pagination, Loading } from "@/modules/cdk";
import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
import { logoClicks } from "@/lib/stores.svelte";
import { gameInfo } from "@/lib/game-info.svelte";
import { loadGames, type LoadGamesResult } from "@/lib/games.svelte";
import { isPromise } from "@bgs/utils";
function $$render() {
/*Ωignore_startΩ*/;let $logoClicks = __sveltets_2_store_get(logoClicks);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  

   let title = "Games";
   let perPage = 10;
   let topRecords = false/*Ωignore_startΩ*/;topRecords = __sveltets_2_any(topRecords);/*Ωignore_endΩ*/;
   let sample = false/*Ωignore_startΩ*/;sample = __sveltets_2_any(sample);/*Ωignore_endΩ*/;
   let gameStatus: IGame["status"]/*Ωignore_startΩ*/;gameStatus = __sveltets_2_any(gameStatus);/*Ωignore_endΩ*/;
   let boardgameId: string | undefined = undefined/*Ωignore_startΩ*/;boardgameId = __sveltets_2_any(boardgameId);/*Ωignore_endΩ*/;
   let userId: string | undefined | null = undefined/*Ωignore_startΩ*/;userId = __sveltets_2_any(userId);/*Ωignore_endΩ*/;
   let minDuration: number | undefined = undefined/*Ωignore_startΩ*/;minDuration = __sveltets_2_any(minDuration);/*Ωignore_endΩ*/;
   let maxDuration: number | undefined = undefined/*Ωignore_startΩ*/;maxDuration = __sveltets_2_any(maxDuration);/*Ωignore_endΩ*/;

  let loadingGames = true;
  let count = 0;
  let currentPage = 0;
  let games: IGame[] = [];

  const load = defer(
    (refresh: boolean) => {
      const fetchCount = refresh && !topRecords && !sample;

      const result = loadGames({
        gameStatus,
        boardgameId,
        userId,
        sample,
        minDuration,
        maxDuration,
        count: perPage,
        skip: currentPage * perPage,
        fetchCount,
      });

      const handleResult = (result: LoadGamesResult) => {
        games = result.games;

        if (fetchCount) {
          count = result.total;
        }
      };

      // We don't want to be a promise if not needed, for SSR
      if (!isPromise(result)) {
        return handleResult(result);
      } else {
        return result.then(handleResult);
      }
    },
    () => (loadingGames = false)
  );

  function playerEloChange(game: IGame) {
    const pl = game.players.find((pl) => pl._id === userId);

    if (!pl || !pl.elo) {
      return;
    }

    const elo = pl.elo.initial ?? 0;
    const delta = pl.elo.delta ?? 0;
    return elo === 0 && delta === 0 ? "" : (delta >= 0 ? "( +" : "( -") + Math.abs(delta) + " elo )";
  }

  function playTime(game: IGame) {
    if (game.options.timing.timer?.start !== game.options.timing.timer?.end) {
      return `${timerTime(game.options.timing.timer?.start)}-${timerTime(game.options.timing.timer?.end)}`;
    } else {
      return "24h";
    }
  }

  function gameIcon(name: string) {
    const game = gameInfo(name, "latest");

    return game?.label.trim().slice(0, game?.label.trim().indexOf(" "));
  }

  const onCurrentPageChanged = createWatcher(() => load(false));

  ;() => {$: (load(true), [userId, boardgameId, $logoClicks]);}
  ;() => {$: (onCurrentPageChanged(), [currentPage]);}
;
async () => {

 { const $$_gnidaoL0C = __sveltets_2_ensureComponent(Loading); new $$_gnidaoL0C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"loading":loadingGames,}});
   { svelteHTML.createElement("h3", { "class":`card-title`,});
    title;
    if(!topRecords && !sample){
       { svelteHTML.createElement("span", { "class":`small`,}); count;  }
    }
   }
   { svelteHTML.createElement("div", {});
    if(games.length > 0){
       { svelteHTML.createElement("ul", { "class":`list-group text-start game-list`,});
          for(let game of __sveltets_2_ensureArray(games)){
           { svelteHTML.createElement("a", {       "href":`/game/${game._id}`,"class":`list-group-item list-group-item-action pe-1 ps-0`,});game.status === "active";game.currentPlayers?.some((pl) => pl._id === userId);
             { svelteHTML.createElement("span", { "class":`game-kind mx-3`,});
              gameIcon(game.game.name);
             }

             { svelteHTML.createElement("div", {   "class":`me-auto`,"style":`line-height: 1.1`,});
               { svelteHTML.createElement("div", {});
                if(game.status === "active"){
                   { const $$_egdaB6C = __sveltets_2_ensureComponent(Badge); new $$_egdaB6C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`contrast`,"class":`small text-light`,}}); game.context?.round ?? 0; Badge}
                }
                 { svelteHTML.createElement("span", { "class":`game-name`,});
                  game._id;
                 }
                if(playerEloChange(game)){
                   { svelteHTML.createElement("sup", { "class":`ms-1`,});
                    playerEloChange(game);
                   }
                }
               }
               { svelteHTML.createElement("small", {});
                if(game.status !== "ended"){
                   { const $$_nocI6C = __sveltets_2_ensureComponent(Icon); new $$_nocI6C({ target: __sveltets_2_any(), props: {    "icon":clockHistory,"inline":true,}});}
                  playTime(game);
                  duration(game.options.timing.timePerGame);  duration(game.options.timing.timePerMove);
                  if(game.options.timing.scheduledStart){  niceDate(game.options.timing.scheduledStart); 
                    new Date(game.options.timing.scheduledStart).getHours().toString().padStart(2, "0"); new Date(
                      game.options.timing.scheduledStart
                    )
                      .getMinutes()
                      .toString()
                      .padStart(2, "0");
                  }
                }else{
                  niceDate(game.lastMove);
                }
               }
             }

            if(game.status !== "open"){
               { svelteHTML.createElement("div", { "class":`factions g-0 row`,});
                  for(let player of __sveltets_2_ensureArray(game.players)){
                   { const $$_ratavAemaGreyalP5C = __sveltets_2_ensureComponent(PlayerGameAvatar); new $$_ratavAemaGreyalP5C({ target: __sveltets_2_any(), props: {         "game":game.game.name,"isCurrent":game.currentPlayers?.some((pl) => pl._id === player._id),userId,player,"class":`me-1`,}});}
                }
               }
            }else{
               { svelteHTML.createElement("div", {   "class":`me-3`,"style":`line-height: 1.1;`,});
                 { svelteHTML.createElement("div", { "class":`text-end`,});game.players.length;  game.options.setup.nbPlayers; }
                 { svelteHTML.createElement("small", {});
                  shortDuration(Math.floor((Date.now() - new Date(game.createdAt).getTime()) / 1000));  }
               }
            }
           }
        }
       }
      if(!topRecords && count > perPage){
         { const $$_noitanigaP2C = __sveltets_2_ensureComponent(Pagination); const $$_noitanigaP2 = new $$_noitanigaP2C({ target: __sveltets_2_any(), props: {      count,perPage,currentPage,"align":`right`,"class":`mt-2`,}});/*Ωignore_startΩ*/() => currentPage = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_noitanigaP2.$$bindings = 'currentPage';}
      }
    }else{
       { svelteHTML.createElement("p", {});    }
    }
   }
 Loading}


};
return { props: {title: title , perPage: perPage , topRecords: topRecords , sample: sample , gameStatus: gameStatus , boardgameId: boardgameId , userId: userId , minDuration: minDuration , maxDuration: maxDuration} as {title?: typeof title, perPage?: typeof perPage, topRecords?: typeof topRecords, sample?: typeof sample, gameStatus: IGame["status"], boardgameId?: string | undefined, userId?: string | undefined | null, minDuration?: number | undefined, maxDuration?: number | undefined}, exports: {}, bindings: "", slots: {}, events: {} }}
const GameList__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type GameList__SvelteComponent_ = InstanceType<typeof GameList__SvelteComponent_>;
/*Ωignore_endΩ*/export default GameList__SvelteComponent_;