///<reference types="svelte" />
;function $$render() {

   let title: string = "Boardgamers"/*Ωignore_startΩ*/;title = __sveltets_2_any(title);/*Ωignore_endΩ*/;
   let description: string =
    "Play Gaia Project, 6nimmt, Powergrid and Container online. All games and the platform are open source!"/*Ωignore_startΩ*/;description = __sveltets_2_any(description);/*Ωignore_endΩ*/;
   let image: string | undefined = undefined/*Ωignore_startΩ*/;image = __sveltets_2_any(image);/*Ωignore_endΩ*/;
;
async () => {

 { svelteHTML.createElement("svelte:head", {});
   { svelteHTML.createElement("title", {});title; }
   { svelteHTML.createElement("meta", {    "name":`description`,"content":description,});}
   { svelteHTML.createElement("meta", {    "property":`og:type`,"content":`website`,});}
  if(image){
     { svelteHTML.createElement("meta", {    "property":`og:image`,"content":image,});}
     { svelteHTML.createElement("meta", {    "property":`og:image:width`,"content":`256`,});}
     { svelteHTML.createElement("meta", {    "property":`og:image:height`,"content":`256`,});}
  }
 }
};
return { props: {title: title , description: description , image: image} as {title?: string, description?: string, image?: string | undefined}, exports: {}, bindings: "", slots: {}, events: {} }}
const SEO__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type SEO__SvelteComponent_ = InstanceType<typeof SEO__SvelteComponent_>;
/*Ωignore_endΩ*/export default SEO__SvelteComponent_;