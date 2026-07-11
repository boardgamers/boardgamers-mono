///<reference types="svelte" />
;
import chat from "@iconify/icons-bi/chat.js";
import { account, currentGameId, sidebarOpen, chatMessages } from "@/lib/stores.svelte";
import { get, post } from "@/lib/api";
import { Modal, ModalHeader, Icon, ModalFooter, Input, InputGroup, Button, Badge } from "@/modules/cdk";
import { dateFromObjectId, dateTime, handleError } from "@/utils";
import { fly } from "svelte/transition";
import UserAvatar from "./User/UserAvatar.svelte";
function $$render() {
/*Ωignore_startΩ*/;let $account = __sveltets_2_store_get(account);;let $currentGameId = __sveltets_2_store_get(currentGameId);;let $sidebarOpen = __sveltets_2_store_get(sidebarOpen);;let $chatMessages = __sveltets_2_store_get(chatMessages);/*Ωignore_endΩ*/
  
  
  
  
  
  
  

  let isOpen = false;
  let toggle = () => {
    isOpen = !isOpen;
  };
  let lastRead: number = 0;
   let room: string/*Ωignore_startΩ*/;room = __sveltets_2_any(room);/*Ωignore_endΩ*/;

  let currentMessage = "";

  const sendMessage = async () => {
    console.log("send message");
    const msg = currentMessage;
    currentMessage = "";

    // Mark message as delivered? by adding meta: 'Delivered'
    return post(`/game/${room}/chat`, {
      author: "me",
      data: {
        text: msg,
      },
      type: "text",
    }).catch(handleError);
  };

  let messagesContainer: HTMLDivElement;

  function onMessagesChanged() {
    setTimeout(() => {
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    });

    if (isOpen) {
      postLastRead();
    }
  }

  async function loadLastRead() {
    if (userId) {
      lastRead = await get(`/game/${room}/chat/lastRead`);
    } else {
      lastRead = 0;
    }
  }

  async function postLastRead() {
    const lastMessage = $chatMessages.slice(-1).pop();

    if (!lastMessage) {
      return;
    }

    const lastMessageTime = dateFromObjectId(lastMessage._id).getTime();

    if (lastMessageTime <= lastRead) {
      return;
    }

    lastRead = Date.now();

    if (userId) {
      await post(`/game/${room}/chat/lastRead`, { lastRead }).catch(handleError);
    }
  }

  let  userId = __sveltets_2_invalidate(() => $account?._id);
  ;() => {$: (onMessagesChanged(), [$chatMessages, isOpen]);}
  ;() => {$: (loadLastRead(), [userId, room]);}
  let  unreadMessages = __sveltets_2_invalidate(() => $chatMessages.filter(
    (msg) => msg.type !== "system" && dateFromObjectId(msg._id).getTime() > lastRead
  ).length);
;
async () => {

  { const $$_ladoM0C = __sveltets_2_ensureComponent(Modal); new $$_ladoM0C({ target: __sveltets_2_any(), props: {          children:() => { return __sveltets_2_any(0); },isOpen,toggle,"backdrop":false,"transitionType":fly,"transitionOptions":{ y: -300 },"class":"chat-modal" + ($sidebarOpen ? " sidebar-open" : ""),}});
   { const $$_redaeHladoM1C = __sveltets_2_ensureComponent(ModalHeader); new $$_redaeHladoM1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },toggle,}}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {      "icon":chat,"height":`1.5rem`,"style":`vertical-align: -0.25rem`,}});} $currentGameId;  ModalHeader}
   { const $$_div1 = svelteHTML.createElement("div", {  "class":`chat-messages modal-body`,});messagesContainer = $$_div1;
      for(let message of __sveltets_2_ensureArray($chatMessages)){
       { svelteHTML.createElement("div", {  "class":`message-container`,});message.author?._id === userId;
        if(message.author){
           { const $$_ratavAresU3C = __sveltets_2_ensureComponent(UserAvatar); new $$_ratavAresU3C({ target: __sveltets_2_any(), props: {      "userId":message.author._id,"username":message.author.name,"size":`3rem`,}});}
        }
         { svelteHTML.createElement("div", {      "class":`message`,"title":"Sent at " + dateTime(dateFromObjectId(message._id)),});message.type === "system";
          message.data.text;
          if(!message.author){
             { svelteHTML.createElement("p", { "class":`message-meta`,});
              dateTime(dateFromObjectId(message._id));
             }
          }
         }
         { svelteHTML.createElement("span", {  "class":`mx-4`,});}
       }
    }
     { svelteHTML.createElement("span", { "style":`height: 0`,});  }
   }
   { const $$_retooFladoM1C = __sveltets_2_ensureComponent(ModalFooter); new $$_retooFladoM1C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
     { svelteHTML.createElement("form", {    "on:submit":sendMessage,"style":`width: 100%`,});
       { const $$_puorGtupnI3C = __sveltets_2_ensureComponent(InputGroup); new $$_puorGtupnI3C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
         { const $$_tupnI4C = __sveltets_2_ensureComponent(Input); const $$_tupnI4 = new $$_tupnI4C({ target: __sveltets_2_any(), props: {    "type":`text`,value:currentMessage,}});/*Ωignore_startΩ*/() => currentMessage = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_tupnI4.$$bindings = 'value';}
         { const $$_nottuB4C = __sveltets_2_ensureComponent(Button); new $$_nottuB4C({ target: __sveltets_2_any(), props: {    children:() => { return __sveltets_2_any(0); },"type":`submit`,"color":`secondary`,"outline":true,}});  Button}
       InputGroup}
     }
   ModalFooter}
 Modal}

  { const $$_nottuB0C = __sveltets_2_ensureComponent(Button); const $$_nottuB0 = new $$_nottuB0C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"color":`primary`,"class":"rounded-circle b-avatar sidebar-fab chat-button" + ($sidebarOpen ? " sidebar-open" : ""),}});$$_nottuB0.$on("click", toggle);
   { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {      "icon":chat,"style":`height: 1.5rem; width: 1.5rem;`,"class":`absolute-center`,}});}
  if(unreadMessages){
     { const $$_egdaB1C = __sveltets_2_ensureComponent(Badge); new $$_egdaB1C({ target: __sveltets_2_any(), props: { children:() => { return __sveltets_2_any(0); },"pill":true,"color":`danger`,}});unreadMessages; Badge}
  }
 Button}


};
return { props: {room: room} as {room: string}, exports: {}, bindings: "", slots: {}, events: {} }}
const ChatRoom__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type ChatRoom__SvelteComponent_ = InstanceType<typeof ChatRoom__SvelteComponent_>;
/*Ωignore_endΩ*/export default ChatRoom__SvelteComponent_;