<template>
  <div class="container account">
    <b-row>
      <b-col
        ><h1>{{ user.account.username }}</h1></b-col
      >
      <b-col class="text-right"
        ><b-button variant="primary" :to="{ name: 'user', params: { username: user.account.username } }"
          >Profile</b-button
        ></b-col
      >
    </b-row>

    <b-card-group deck class="game-choice mt-4">
      <UserGameSettings :game="game" v-for="game in $gameInfo.latest" :key="game._id.game" />
    </b-card-group>

    <b-card border-variant="info" class="mt-4" header="User Settings">
      <p v-if="user.account.username">
        Username: <strong>{{ user.account.username }}</strong>
      </p>
      <div class="form-group">
        <label for="email">Email</label>
        <b-input-group>
          <b-form-input
            type="email"
            placeholder="Email address"
            v-model.trim="email"
            @keyup.prevent.stop.enter.native="saveEmail"
            :disabled="!editingEmail"
          />
          <template #append>
            <b-button variant="outline-secondary" v-if="!editingEmail" @click="editingEmail = true">Edit</b-button>
            <b-button variant="outline-success" v-if="editingEmail" @click="saveEmail">Save</b-button>
          </template>
        </b-input-group>
        <small v-if="user.security.confirmed">Your email is confirmed.</small>
        <small v-else>Your email is not confirmed.</small>
      </div>
      <p>
        Connect with
        <b-btn
          variant="google"
          class="mx-1"
          href="/api/account/auth/google"
          :disabled="!!(user.account.social && user.account.social.google)"
          >Google</b-btn
        >
        <b-btn
          variant="discord"
          class="mx-1"
          href="/api/account/auth/discord"
          :disabled="!!(user.account.social && user.account.social.discord)"
          >Discord</b-btn
        >
        <b-btn
          variant="facebook"
          class="mx-1"
          href="/api/account/auth/facebook"
          :disabled="!!(user.account.social && user.account.social.facebook)"
          >Facebook</b-btn
        >
      </p>
      <b-checkbox v-if="!user.account.termsAndConditions" class="mb-3" v-model="tc" @change="acceptTC"
        >I agree to the <router-link to="/page/terms-and-conditions">Terms and Conditions</router-link></b-checkbox
      >
      <p v-else>
        I accepted the <router-link to="/page/terms-and-conditions">Terms and Conditions</router-link> on
        {{ user.account.termsAndConditions | niceDate }}.
      </p>
      <hr />
      <b-checkbox v-model="newsletter" @change="updateAccountDebounce">
        Get newsletter, up to six emails per year.</b-checkbox
      >
      <div class="form-row align-items-center">
        <div class="col-auto">
          <b-checkbox v-model="gameNotification" @change="updateAccountDebounce">
            Receive an email when it's your turn after a delay of
          </b-checkbox>
        </div>
        <div class="col-auto">
          <select
            class="form-control form-control-sm"
            v-model="gameNotificationDelay"
            @change="
              gameNotification = true;
              updateAccountDebounce();
            "
          >
            <option
              v-for="val of [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600]"
              :value="val"
              :key="val"
            >
              {{ val | duration }}
            </option>
          </select>
        </div>
      </div>
    </b-card>
    <b-card border-variant="info" class="mt-4" header="Game Settings">
      <b-checkbox v-model="soundNotification" @change="updateAccountDebounce"
        >Play a sound when it's your turn in one of your games</b-checkbox
      >
      <b-checkbox v-model="notifications">Notification on this device when it's your turn</b-checkbox>
    </b-card>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from "vue-property-decorator";
import { IUser } from "@lib/user";
import { handleError } from "@/utils";
import debounce from "lodash/debounce";
import UserGames from "../components/UserGames.vue";
import UserGameSettings from "../components/UserGameSettings.vue";
import UserPublicInfo from "../components/UserPublicInfo.vue";
import UserElo from "../components/UserElo.vue";
import { IGame } from "@lib/game";

@Component<Account>({
  components: {
    UserGames,
    UserGameSettings,
    UserPublicInfo,
    UserElo,
  },
  created() {
    this.$gameInfo.loadAll();
    this.notifications = !!localStorage.getItem("notifications");
  },
})
export default class Account extends Vue {
  email: string = "";
  editingEmail = false;
  newsletter: boolean = false;
  soundNotification: boolean = false;
  notifications = false;
  gameNotification: boolean = false;
  gameNotificationDelay: number = 30 * 60;
  tc = false;

  constructor() {
    super();

    this.email = this.user.account.email;
    this.soundNotification = !!this.user.settings?.game?.soundNotification;
    this.newsletter = !!this.user.settings?.mailing?.newsletter;
    this.gameNotification = !!this.user.settings?.mailing?.game?.activated;
    this.gameNotificationDelay = this.user.settings?.mailing?.game?.delay ?? 30 * 60;
    this.updateAccount.bind(this);
  }

  get user(): IUser {
    return this.$store.state.user;
  }

  async acceptTC() {
    const accepted = await this.$bvModal.msgBoxConfirm(
      "The terms and conditions will be marked as accepted at today's date."
    );

    if (!accepted) {
      this.tc = false;
      return;
    }

    try {
      const user = await this.$axios.post("/account/terms-and-conditions").then((r) => r.data);
      this.$store.commit("updateUser", user);
    } catch (err) {
      handleError(err);
    }
  }

  updateAccount() {
    this.$axios
      .post("/account", {
        settings: {
          mailing: {
            newsletter: this.newsletter,
            game: {
              activated: this.gameNotification,
              delay: this.gameNotificationDelay,
            },
          },
          game: {
            soundNotification: this.soundNotification,
          },
        },
      })
      .then(
        (r) => this.$store.commit("updateUser", r.data),
        (err) => handleError(err)
      );
  }

  async saveEmail() {
    try {
      const data = await this.$axios.post("/account/email", { email: this.email }).then((response) => response.data);
      this.$store.commit("updateUser", data);
    } catch (err) {
      handleError(err);
    }
  }

  @Watch("notifications")
  notificationsChanged() {
    if (this.notifications) {
      if (Notification.permission !== "granted") {
        Notification.requestPermission();
      }
    }

    if (!!localStorage.getItem("notifications") !== this.notifications) {
      localStorage.setItem("notifications", this.notifications ? "1" : "");
    }
  }

  updateAccountDebounce = debounce(this.updateAccount, 800, { leading: false });
}
</script>
