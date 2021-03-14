<script lang="ts">
  import type { IUser } from "@lib/user";
  import { classnames, dateFromObjectId } from "@/utils";
  import { Card } from "@cdk";

  export let user: IUser

  let className = '';
  export { className as class };

  $: classes = classnames(className, 'border-info');
  $: joinDate = user && dateFromObjectId(user._id)
</script>

<Card class={classes} header="About">
  ☯️ <a href="/page/karma" title="karma">{user.account.karma}</a> karma <br />
  🎉 Joined us in {joinDate.toLocaleString("default", { month: "long" })}
  {joinDate.toLocaleString("default", { year: "numeric" })}!
</Card>
