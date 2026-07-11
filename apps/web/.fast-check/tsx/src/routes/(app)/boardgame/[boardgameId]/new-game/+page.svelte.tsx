///<reference types="svelte" />
;
import { handleError, oneLineMarked, duration } from "@/utils";
import marked from "marked";
import { fromPairs, upperFirst } from "lodash";
import { Button, Col, Input, Checkbox, Row, Container } from "@/modules/cdk";
import { goto } from "$app/navigation";
import { adjectives, nouns } from "@/data";
import { fade } from "svelte/transition";
import type { PlayerOrder } from "@bgs/models";
import { playerOrders } from "@/data/playerOrders";
import { account } from "@/lib/account.svelte";
import { useLoggedIn } from "@/lib/auth-guards.svelte";
import { post } from "@/lib/api";
import { gameInfo } from "@/lib/game-info.svelte";
import { page } from "$app/stores";
import { SEO } from "@/components";
import removeMarkdown from "remove-markdown";
import { gameLabel } from "@/utils/game-label";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $page = __sveltets_2_store_get(page);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  useLoggedIn();

  let  boardgameId = __sveltets_2_invalidate(() => $page.params.boardgameId); // Can be undefined during page navigation out
  let  info = __sveltets_2_invalidate(() => gameInfo(boardgameId, "latest"));

  let gameId = randomId();
  let seed = "";
  let numPlayers = 2;

  let options = ["join"];
  let playerOrder: PlayerOrder = "random";
  let selects: Record<string, string> = {};
  let expansions: string[] = [];

  let timePerMove = 2 * 3600;
  let timePerGame = 3 * 24 * 3600;
  let submitting = false;
  let timerEnd = "22:00";
  let timerStart = "09:00";

  let scheduledDay = null as string | null;
  let scheduledTime = "";

  let enableKarma = false;
  let minimumKarma = Math.min(75, $account!.account.karma - 5);

  function createGame() {
    submitting = true;

    const dataObj = {
      game: {
        game: boardgameId,
        version: info._id.version,
      },
      gameId,
      players: numPlayers,
      timePerMove,
      timePerGame,
      options: { ...fromPairs(options.map((key) => [key, true])), ...selects, playerOrder },
      seed,
      expansions,
      timerStart: undefined as number | undefined,
      timerEnd: undefined as number | undefined,
      scheduledStart: undefined as number | undefined,
      minimumKarma: +minimumKarma as number | undefined,
    };

    if (scheduledDay && scheduledTime) {
      dataObj.scheduledStart = Date.parse(`${scheduledDay}T${scheduledTime}`);
    } else {
      delete dataObj.scheduledStart;
    }

    if (!enableKarma || !dataObj.minimumKarma) {
      delete dataObj.minimumKarma;
    }

    if (timerStart === undefined || timerStart === timerEnd || timerEnd === undefined) {
      delete dataObj.timerStart;
      delete dataObj.timerEnd;
    } else {
      const toTime = (x: string) => {
        const hours = +x.slice(0, 2);
        const minutes = +x.slice(3, 5);

        return (hours * 3600 + minutes * 60 + new Date().getTimezoneOffset() * 60 + 24 * 3600) % (24 * 3600);
      };

      dataObj.timerStart = toTime(timerStart);
      dataObj.timerEnd = toTime(timerEnd);
    }

    post("/game/new-game", dataObj)
      .then(() => goto("/game/" + gameId), handleError)
      .finally(() => (submitting = false));
  }

  $: gameId = __sveltets_2_invalidate(() => gameId.trim().replace(/ /g, "-"));

  const updateSelects = async () => {
    // Load default values for multiple choice options
    const newVal: Record<string, string> = {};

    for (const select of info.options.filter((option) => option.type === "select")) {
      if (select.items) {
        newVal[select.name] =
          select.default && select.items.some((item) => item.name === select.default)
            ? select.default
            : select.items[0].name;
      }
    }

    for (const check of info.options.filter((option) => option.type === "checkbox")) {
      if (check.default === true) {
        options.push(check.name);
      }
    }

    if (!info.players.includes(numPlayers)) {
      numPlayers = info.players[0];
    }

    selects = newVal;
  };

  ;() => {$: info && updateSelects();}

  function randomId() {
    return (
      upperFirst(adjectives[Math.floor(Math.random() * adjectives.length)]) +
      "-" +
      nouns[Math.floor(Math.random() * nouns.length)] +
      "-" +
      Math.ceil(Math.random() * 9999)
    );
  }
;
async () => {

if(info){
   { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {    "title":`Create a ${gameLabel(info.label)} game`,"description":removeMarkdown(info.description),}});}

   { const $$_reniatnoC0C = __sveltets_2_ensureComponent(Container); new $$_reniatnoC0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { svelteHTML.createElement("h1", { "class":`mb-4`,});info.label; }
     { svelteHTML.createElement("form", {  "on:submit":createGame,});
       { svelteHTML.createElement("div", { "class":`row`,});
         { svelteHTML.createElement("div", { "class":`col-md-6`,});
           { svelteHTML.createElement("h2", {});  }
           marked(info.description);
         }

         { svelteHTML.createElement("div", { "class":`col-md-6`,});
           { svelteHTML.createElement("h2", {});  }
           marked(info.rules);
         }
       }

       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("div", { "class":`row`,});
         { svelteHTML.createElement("div", { "class":`form-group col-md-4`,});
           { svelteHTML.createElement("label", { "for":`players`,});   }
           { const $$_tupnI4C = __sveltets_2_ensureComponent(Input); const $$_tupnI4 = new $$_tupnI4C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"type":`select`,value:numPlayers,}});/*Ωignore_startΩ*/() => numPlayers = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI4.$$bindings = 'value';
              for(let option of __sveltets_2_ensureArray(info.players)){
               { svelteHTML.createElement("option", { "value":option,});option;  }
            }
           Input}
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-4`,});
           { svelteHTML.createElement("label", { "for":`gameId`,});  }
           { svelteHTML.createElement("input", {                  "class":`form-control`,"id":`gameId`,"type":`text`,"maxlength":25,"name":`gameId`,"bind:value":gameId,"placeholder":`Game ID`,"aria-label":`Game ID`,"required":true,});/*Ωignore_startΩ*/() => gameId = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});      }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-4`,});
           { svelteHTML.createElement("label", { "for":`seed`,});  }
           { svelteHTML.createElement("input", {                 "class":`form-control`,"id":`seed`,"type":`text`,"maxlength":25,"name":`gameId`,"bind:value":seed,"placeholder":`Random seed`,"aria-label":`Random seed`,});/*Ωignore_startΩ*/() => seed = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});        }
         }
       }

       { const $$_woR2C = __sveltets_2_ensureComponent(Row); new $$_woR2C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"class":`mb-3`,}});
         { const $$_loC3C = __sveltets_2_ensureComponent(Col); new $$_loC3C({ target: __sveltets_2_any(), props: {   children:() => { return __sveltets_2_any(0); },"sm":`3`,"class":`d-flex align-items-center`,}});
           { const $$_xobkcehC4C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC4 = new $$_xobkcehC4C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },checked:enableKarma,}});/*Ωignore_startΩ*/() => enableKarma = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC4.$$bindings = 'checked';  Checkbox}
         Col}
         { const $$_loC3C = __sveltets_2_ensureComponent(Col); new $$_loC3C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"sm":`9`,}});
           { const $$_tupnI4C = __sveltets_2_ensureComponent(Input); const $$_tupnI4 = new $$_tupnI4C({ target: __sveltets_2_any(), props: {           "type":`number`,"disabled":!enableKarma,"placeholder":`Minimum karma to join the game`,value:minimumKarma,"max":$account.account.karma - 5,}});/*Ωignore_startΩ*/() => minimumKarma = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI4.$$bindings = 'value';}
         Col}
       Row}

      if(info.expansions.length > 0){
         { svelteHTML.createElement("div", { "class":`mb-3`,});
           { svelteHTML.createElement("h3", {});  }
            for(let expansion of __sveltets_2_ensureArray(info.expansions)){
             { const $$_xobkcehC3C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC3 = new $$_xobkcehC3C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },group:expansions,"value":expansion.name,}});/*Ωignore_startΩ*/() => expansions = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC3.$$bindings = 'group';
               oneLineMarked(expansion.label);
             Checkbox}
          }
         }
      }

       { svelteHTML.createElement("h3", {});  }

       { const $$_woR2C = __sveltets_2_ensureComponent(Row); new $$_woR2C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`timePerGame`,});     }
           { svelteHTML.createElement("select", {     "bind:value":timePerGame,"id":`timePerGame`,"class":`form-control`,});/*Ωignore_startΩ*/() => timePerGame = __sveltets_2_any(null);/*Ωignore_endΩ*/
              for(let x of __sveltets_2_ensureArray(([60, 180, 300, 600, 1800, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 10 * 24 * 3600]))){
               { svelteHTML.createElement("option", { "value":x,});
                duration(x);
               }
            }
           }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`timePerMove`,});    }
           { svelteHTML.createElement("select", {     "bind:value":timePerMove,"id":`timePerMove`,"class":`form-control`,});/*Ωignore_startΩ*/() => timePerMove = __sveltets_2_any(null);/*Ωignore_endΩ*/
              for(let x of __sveltets_2_ensureArray(([5, 10, 30, 60, 5 * 60, 15 * 60, 3600, 2 * 3600, 6 * 3600, 24 * 3600]))){
               { svelteHTML.createElement("option", { "value":x,});
                duration(x);
               }
            }
           }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`scheduledDate`,});   }
           { svelteHTML.createElement("input", {        "type":`date`,"class":`form-control`,"bind:value":scheduledDay,"placeholder":`Scheduled day`,});/*Ωignore_startΩ*/() => scheduledDay = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});        }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`scheduledTime`,});   }
           { svelteHTML.createElement("input", {        "type":`time`,"class":`form-control`,"bind:value":scheduledTime,"placeholder":`Scheduled time`,});/*Ωignore_startΩ*/() => scheduledTime = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});         }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`timerStart`,});   }
           { svelteHTML.createElement("input", {        "type":`time`,"class":`form-control`,"bind:value":timerStart,"placeholder":`Timer start`,});/*Ωignore_startΩ*/() => timerStart = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});           }
         }

         { svelteHTML.createElement("div", { "class":`form-group col-md-6`,});
           { svelteHTML.createElement("label", { "for":`timerEnd`,});   }
           { svelteHTML.createElement("input", {        "type":`time`,"class":`form-control`,"bind:value":timerEnd,"placeholder":`Timer pause`,});/*Ωignore_startΩ*/() => timerEnd = __sveltets_2_any(null);/*Ωignore_endΩ*/}
           { svelteHTML.createElement("small", { "class":`form-text text-muted`,});         }
         }
       Row}

      if(!scheduledDay || !scheduledTime){
         { svelteHTML.createElement("p", {  "class":`mt-2`,});__sveltets_2_ensureTransition(fade(svelteHTML.mapElementTag('p')));
                    timePerGame <= 600
            ? "an hour"
            : timePerGame <= 3600
              ? "three hours"
              : "a week";
         }
      }

       { svelteHTML.createElement("h3", {});  }

       { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },group:options,"value":`unlisted`,}});/*Ωignore_startΩ*/() => options = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'group';  Checkbox}
       { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },group:options,"value":`join`,}});/*Ωignore_startΩ*/() => options = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'group';   Checkbox}
        for(let option of __sveltets_2_ensureArray(info.options.filter((opt) => opt.type === "checkbox"))){
         { const $$_xobkcehC2C = __sveltets_2_ensureComponent(Checkbox); const $$_xobkcehC2 = new $$_xobkcehC2C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },group:options,"value":option.name,}});/*Ωignore_startΩ*/() => options = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_xobkcehC2.$$bindings = 'group'; oneLineMarked(option.label); Checkbox}
      }

       { svelteHTML.createElement("div", { "class":`form-group mt-2`,});
         { svelteHTML.createElement("label", { "for":`playerOrder`,});  }
         { const $$_tupnI3C = __sveltets_2_ensureComponent(Input); const $$_tupnI3 = new $$_tupnI3C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"type":`select`,value:playerOrder,"id":`playerOrder`,"required":true,}});/*Ωignore_startΩ*/() => playerOrder = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI3.$$bindings = 'value';
            for(let item of __sveltets_2_ensureArray(playerOrders)){
             { svelteHTML.createElement("option", { "value":item.name,});item.label; }
          }
         Input}
       }

        for(let select of __sveltets_2_ensureArray(info.options.filter((opt) => opt.type === "select"))){
         { svelteHTML.createElement("div", { "class":`form-group mt-2`,});
           { svelteHTML.createElement("label", { "for":select.name,}); oneLineMarked(select.label); }
           { const $$_tupnI3C = __sveltets_2_ensureComponent(Input); const $$_tupnI3 = new $$_tupnI3C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"type":`select`,value:selects[select.name],"id":select.name,"required":true,}});/*Ωignore_startΩ*/() => selects[select.name] = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI3.$$bindings = 'value';
              for(let item of __sveltets_2_ensureArray(select.items || [])){
               { svelteHTML.createElement("option", { "value":item.name,});marked(item.label).replace(/<[^>]+>/g, ""); }
            }
           Input}
         }
      }

       { const $$_nottuB2C = __sveltets_2_ensureComponent(Button); new $$_nottuB2C({ target: __sveltets_2_any(), props: {       children:() => { return __sveltets_2_any(0); },"class":`mt-3 float-right`,"type":`submit`,"color":`primary`,"disabled":submitting,}});  Button}
     }
   Container}
}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Page__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Page__SvelteComponent_ = InstanceType<typeof Page__SvelteComponent_>;
/*Ωignore_endΩ*/export default Page__SvelteComponent_;