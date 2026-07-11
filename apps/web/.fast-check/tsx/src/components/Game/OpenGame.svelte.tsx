///<reference types="svelte" />
;
import {
    duration,
    handleError,
    niceDate,
    oneLineMarked,
    pluralize,
    timerTime,
    confirm,
    localTimezone,
    createWatcher,
    defer,
  } from "@/utils";
import clockHistory from "@iconify/icons-bi/clock-history.js";
import arrowDown from "@iconify/icons-bi/arrow-down.js";
import arrowUp from "@iconify/icons-bi/arrow-up.js";
import marked from "marked";
import {
    Badge,
    Button,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownToggle,
    FormGroup,
    Input,
    Icon,
  } from "@/modules/cdk";
import { getContext } from "svelte";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import { playerOrderText } from "@/data/playerOrders";
import { account as user } from "@/lib/account.svelte";
import { lastGameUpdate } from "@/lib/stores.svelte";
import { get, post } from "@/lib/api";
import { loadGame, loadGamePlayers } from "@/lib/game.svelte";
import { goto } from "$app/navigation";
import { redirectLoggedIn } from "@/utils/redirect";
import { page } from "$app/stores";
import SEO from "../SEO.svelte";
import removeMarkdown from "remove-markdown";
import { gameLabel } from "@/utils/game-label";
import type { IUser } from "@bgs/models";
import { debounce, map } from "lodash";
function $$render() {
/*Ωignore_startΩ*/;let $user = __sveltets_2_store_get(user);;let $lastGameUpdate = __sveltets_2_store_get(lastGameUpdate);;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  const { game, players, gameInfo }: GameContext = getContext("game")/*Ωignore_startΩ*/;let $game = __sveltets_2_store_get(game);;let $players = __sveltets_2_store_get(players);;let $gameInfo = __sveltets_2_store_get(gameInfo);/*Ωignore_endΩ*/;
  let  timer = __sveltets_2_invalidate(() => $game.options.timing.timer);
  let  gameId = __sveltets_2_invalidate(() => $game._id);

  const shortPlayTime = () => {
    if (timer?.start !== timer?.end) {
      return `${timerTime(timer?.start)}-${timerTime(timer?.end)}`;
    } else {
      return "24h";
    }
  };

  const playTime = () => {
    if (timer?.start !== undefined) {
      return `active between ${timerTime(timer?.start)} and ${timerTime(
        timer?.end
      )}, in your local time (${localTimezone()})`;
    } else {
      return "always active";
    }
  };

  const leave = async () => {
    if (await confirm("Are you sure you want to leave this game?")) {
      post(`/game/${gameId}/unjoin`).then(() => goto("/"), handleError);
    }
  };

  const join = async () => {
    if (!$user) {
      goto(redirectLoggedIn($page.url));
      return;
    }

    if ($game.options.timing.timePerGame <= 24 * 3600) {
      if (
        !(await confirm(
          "This game has a short duration. You need to keep yourself available in order to play the game until the end."
        ))
      ) {
        return;
      }
    }

    post(`/game/${gameId}/join`).catch(handleError);
  };

  let playerOrder: number[];

  function refreshPlayerOrder() {
    playerOrder = $game.players.map((_, i) => i);
  }

  ;() => {$: (refreshPlayerOrder(), [$game]);}

  const moveUp = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index > 0) {
      const tmp = playerOrder[index - 1];
      playerOrder[index - 1] = playerOrder[index];
      playerOrder[index] = tmp;
      playerOrder = playerOrder;
    }
  };

  const moveDown = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index + 1 < playerOrder.length) {
      const tmp = playerOrder[index + 1];
      playerOrder[index + 1] = playerOrder[index];
      playerOrder[index] = tmp;
      playerOrder = playerOrder;
    }
  };

  let  canStart = __sveltets_2_invalidate(() => $game.options.setup.nbPlayers === $game.players.length && !$game.ready && $user?._id === $game.creator);

  const start = () => {
    post(`/game/${gameId}/start`, { playerOrder: playerOrder.map((x) => $game.players[x]._id) }).catch(handleError);
  };

  let isOpen = false;

  let foundUsers: IUser[] = [];
  let query = "";

  const invite = defer(async (userId: string, isName = false) => {
    if (isName) {
      const user = await get<IUser>(`/user/infoByName/${encodeURIComponent(userId)}`);
      userId = user._id;
    }
    post(`/game/${gameId}/invite`, { userId });
  });

  const watcher = debounce(
    async () => {
      if (query) {
        foundUsers = (await get<IUser[]>("/user/search", { name: query.trim() }).catch(handleError)) || [];
      } else {
        foundUsers = [];
      }
    },
    400,
    { leading: false }
  );

  ;() => {$: (watcher(), query);}

  const updateGameWatcher = createWatcher(async () => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);

      if ($game && gameId === g._id) {
        $game = g;
        $players = p;
      }
    }
  });

  // Autorefresh when another player joins
  ;() => {$: (updateGameWatcher(), $lastGameUpdate);}
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {     "title":`${gameId} - ${gameLabel($gameInfo.label)} game`,"description":`${$game.players.length} / ${$game.options.setup.nbPlayers} players. Timer of ${duration(
    $game.options.timing.timePerGame
  )} per player, with an additional ${duration($game.options.timing.timePerMove)} per move.
${$game.game.expansions?.length > 0 &&
    `
      Expansions: ${$game.game.expansions.join(',')}
`}
${$gameInfo.options
    .filter((x) => !!($game.game.options || {})[x.name])
    .map((pref) =>
      pref.type === 'checkbox'
        ? pref.label
        : pref.type === 'select' && pref.items
          ? pref.label + ': ' + pref.items.find((x) => x.name === $game.game.options[pref.name])?.label
          : ''
    )
    .filter(Boolean)
    .map((str) => `- ${removeMarkdown(str)}`)
    .join('\n')}`,}});}

 { svelteHTML.createElement("div", { "class":`container pb-3`,});
   { svelteHTML.createElement("h1", { "class":`mb-3`,});$gameInfo.label;    }

   { svelteHTML.createElement("div", { "class":`row`,});
     { svelteHTML.createElement("div", { "class":`col-md-6`,});
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("div", {});
         marked($gameInfo.description);
       }
     }

     { svelteHTML.createElement("div", { "class":`col-md-6`,});
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("div", {});
         marked($gameInfo.rules);
       }
     }
   }

   { svelteHTML.createElement("h2", {});  }
   { svelteHTML.createElement("p", {});
      { svelteHTML.createElement("i", {});gameId; }  

     { svelteHTML.createElement("a", { "href":`/user/${$players.find((pl) => pl._id === $game.creator)?.name}`,});
      $players.find((pl) => pl._id === $game.creator)?.name;
     }

     { svelteHTML.createElement("br", {});}
     { svelteHTML.createElement("small", { "class":`text-muted`,});
      if(typeof $game.options.meta?.minimumKarma === "number"){
         { svelteHTML.createElement("span", { "title":`Minimum karma to join the game`,});
           $game.options.meta.minimumKarma;
         }
      }

      if($game.options.setup.seed){
         { svelteHTML.createElement("span", { "title":`Game seed`,});  $game.options.setup.seed; }
      }
       { svelteHTML.createElement("span", {   "class":`ps-1`,"title":`Timezone`,});  { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {    "icon":clockHistory,"inline":true,}});} shortPlayTime(); }
     }
   }

  if($game.options.timing.scheduledStart){
     { svelteHTML.createElement("div", { "class":`mb-3`,});
       { svelteHTML.createElement("b", {});
              niceDate($game.options.timing.scheduledStart); 
        new Date($game.options.timing.scheduledStart).toLocaleTimeString("en");
       }
     }
  }

   { svelteHTML.createElement("h3", {});  }

   { svelteHTML.createElement("div", {});
    duration($game.options.timing.timePerGame);     
    duration($game.options.timing.timePerMove);  
   }
   { svelteHTML.createElement("div", {}); playTime(); }

  if($game.game.expansions?.length > 0){
     { svelteHTML.createElement("div", { "class":`mt-3`,});
       { svelteHTML.createElement("h3", {});  }
        for(let expansion of __sveltets_2_ensureArray($game.game.expansions)){
         { const $$_egdaB2C = __sveltets_2_ensureComponent(Badge); new $$_egdaB2C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },"color":`info`,}}); oneLineMarked($gameInfo.expansions.find((xp) => xp.name === expansion)?.label ?? "");  Badge}
      }
     }
  }

   { svelteHTML.createElement("div", { "class":`mt-3`,});
     { svelteHTML.createElement("h3", {});  }

     { const $$_egdaB2C = __sveltets_2_ensureComponent(Badge); new $$_egdaB2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`secondary`,"class":`me-1`,}});playerOrderText($game.options.setup.playerOrder); Badge}
      for(let pref of __sveltets_2_ensureArray($gameInfo.options.filter((x) => !!($game.game.options || {})[x.name]))){
       { const $$_egdaB2C = __sveltets_2_ensureComponent(Badge); new $$_egdaB2C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`secondary`,"class":`me-1`,}});
        if(pref.type === "checkbox"){
           oneLineMarked(pref.label);
        } else if (pref.type === "select" && pref.items && pref.items.some((x) => x.name === $game.game.options[pref.name])){
           oneLineMarked(
            pref.label + ": " + pref.items.find((x) => x.name === $game.game.options[pref.name])?.label
          );
        }
       Badge}
    }
   }

   { svelteHTML.createElement("div", { "class":`my-3`,});
     { svelteHTML.createElement("h3", {});  }
    if($game.players.length > 0){
       { svelteHTML.createElement("div", { "class":`mb-2`,});
          for(let player of __sveltets_2_ensureArray($game.players)){
           { svelteHTML.createElement("div", {});
            
             { svelteHTML.createElement("a", { "href":`/user/${$players.find((pl) => pl._id === player._id)?.name}`,});
              $players.find((pl) => pl._id === player._id)?.name;
             }
             $players.find((pl) => pl._id === player._id)?.elo;  if(player.pending){ { svelteHTML.createElement("span", { "class":`text-muted`,});
                
               }}
           }
        }
       }
    }
    if($game.options.setup.nbPlayers > $game.players.length){
       { svelteHTML.createElement("p", {});  pluralize($game.options.setup.nbPlayers - $game.players.length, "more player"); }
      if($user?._id === $game.creator && (1 || $game.options.timing.scheduledStart)){
         { const $$_puorGmroF2C = __sveltets_2_ensureComponent(FormGroup); new $$_puorGmroF2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
           { svelteHTML.createElement("label", { "for":`invite`,});  }
           { const $$_nwodporD3C = __sveltets_2_ensureComponent(Dropdown); new $$_nwodporD3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"isOpen":Boolean(isOpen && foundUsers.length),"toggle":() => (isOpen = !isOpen),}});
             { const $$_elggoTnwodporD4C = __sveltets_2_ensureComponent(DropdownToggle); new $$_elggoTnwodporD4C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"tag":`div`,"class":`d-inline-block`,}});
               { const $$_tupnI5C = __sveltets_2_ensureComponent(Input); const $$_tupnI5 = new $$_tupnI5C({ target: __sveltets_2_any(), props: {       "id":`invite`,value:query,}});/*Ωignore_startΩ*/() => query = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI5.$$bindings = 'value';$$_tupnI5.$on("keydown", (e) => e.key === "Enter" && invite(e.target.value, true));}
             DropdownToggle}
             { const $$_uneMnwodporD4C = __sveltets_2_ensureComponent(DropdownMenu); new $$_uneMnwodporD4C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
                for(let result of __sveltets_2_ensureArray(foundUsers)){
                 { const $$_metInwodporD5C = __sveltets_2_ensureComponent(DropdownItem); const $$_metInwodporD5 = new $$_metInwodporD5C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },}});$$_metInwodporD5.$on("click", () => invite(result._id));result.account.username; DropdownItem}
              }
             DropdownMenu}
           Dropdown}
         FormGroup}
      }
    } else if (!$game.ready){
      if($user?._id === $game.creator){
        if($game.options.setup.playerOrder === "host"){
           { svelteHTML.createElement("h3", {});   }
            for(let playerIndex of __sveltets_2_ensureArray(playerOrder)){
             { svelteHTML.createElement("div", {});
               $game.players[playerIndex].name;
               { svelteHTML.createElement("span", {    "on:click":() => moveUp(playerIndex),"role":`button`,}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {    "icon":arrowUp,"inline":true,}});} }
               { svelteHTML.createElement("span", {    "on:click":() => moveDown(playerIndex),"role":`button`,}); { const $$_nocI4C = __sveltets_2_ensureComponent(Icon); new $$_nocI4C({ target: __sveltets_2_any(), props: {    "icon":arrowDown,"inline":true,}});} }
             }
          }
           { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); const $$_nottuB2 = new $$_nottuB2C({ target: __sveltets_2_any(), props: {     children:() => { return __sveltets_2_any(0); },"color":`primary`,"class":`mt-4`,}});$$_nottuB2.$on("click", start);   Button}
        }
      } else if ($game.players.some((p) => p.pending)){
         { svelteHTML.createElement("p", {});        }
      }else{
         { svelteHTML.createElement("p", {}); { svelteHTML.createElement("b", {});      } }
      }
    } else if ($game.options.timing.scheduledStart){
       { svelteHTML.createElement("p", {});    }
    }
   }

  if(!canStart){
    if($game.players.some((pl) => pl._id === $user?._id)){
      if($game.players.find((pl) => pl._id === $user._id).pending){
         { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`accent`,}});$$_nottuB1.$on("click", join);  Button}
         { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`secondary`,}});$$_nottuB1.$on("click", leave);  Button}
      }else{
         { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`warning`,}});$$_nottuB1.$on("click", leave);  Button}
      }
    }else{
       { const $$_nottuB1C = __sveltets_2_ensureComponent(Button); const $$_nottuB1 = new $$_nottuB1C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"color":`accent`,}});$$_nottuB1.$on("click", join);  Button}
    }
  }
 }
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const OpenGame__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type OpenGame__SvelteComponent_ = InstanceType<typeof OpenGame__SvelteComponent_>;
/*Ωignore_endΩ*/export default OpenGame__SvelteComponent_;