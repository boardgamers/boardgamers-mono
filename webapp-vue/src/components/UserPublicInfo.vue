<template>
  <b-card border-variant="info" header="About">
    ☯️ <router-link to="/page/karma" title="karma">{{ user.account.karma }}</router-link> karma <br />
    🎉 Joined us in {{ joinDate.toLocaleString("default", { month: "long" }) }}
    {{ joinDate.toLocaleString("default", { year: "numeric" }) }}!
  </b-card>
</template>
<script lang="ts">
import { Vue, Component, Prop, Watch } from "vue-property-decorator";
import type { IUser } from "@lib/user";
import { handleError, dateFromObjectId } from "@/utils";

@Component
export default class UserPublicInfo extends Vue {
  @Prop()
  user: IUser;

  get joinDate() {
    console.log(this.user._id, dateFromObjectId(this.user._id));
    return dateFromObjectId(this.user._id);
  }
}
</script>
