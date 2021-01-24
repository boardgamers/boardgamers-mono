<template>
  <nav class="navbar navbar-dark bg-primary navbar-expand navbar-fixed-top mb-3" id="navbar">
    <router-link class="navbar-brand" to="/"><span @click="navbarClick">BGS</span></router-link>
    <router-link
      :class="[
        'btn',
        'btn-sm',
        'mr-auto',
        { 'btn-success': activeGames.length > 0, 'btn-secondary': activeGames.length === 0 },
      ]"
      to="/next-game"
      v-if="user"
      title="Jump to next active game"
      id="active-game-count"
    >
      {{ activeGames.length }}
    </router-link>
    <router-link class="navbar-brand ml-3 d-lg-none" to="/boardgames">
      <b-iconstack font-scale="1">
        <b-icon stacked icon="square"></b-icon>
        <b-icon stacked icon="dot" shift-h="-3" shift-v="4"></b-icon>
        <b-icon stacked icon="dot" shift-h="-3"></b-icon>
        <b-icon stacked icon="dot" shift-h="-3" shift-v="-4"></b-icon>
        <b-icon stacked icon="dot" shift-h="3" shift-v="4"></b-icon>
        <b-icon stacked icon="dot" shift-h="3"></b-icon>
        <b-icon stacked icon="dot" shift-h="3" shift-v="-4"></b-icon>
      </b-iconstack>
    </router-link>

    <button
      class="navbar-toggler"
      type="button"
      data-toggle="collapse"
      data-target="#navbarSupportedContent"
      aria-controls="navbarSupportedContent"
      aria-expanded="false"
      aria-label="Menu déroulant de navigation"
    >
      <span class="navbar-toggler-icon"></span>
    </button>

    <div class="collapse navbar-collapse" id="navbarSupportedContent">
      <!-- <ul class="navbar-nav mr-auto">
        <li class="nav-item">
          <router-link class="nav-link" to="/about">About</router-link>
        </li>
      </ul>-->
      <ul class="navbar-nav ml-auto">
        <li class="nav-item d-none d-sm-inline" v-if="!user"><span class="navbar-text">Have an account ?</span></li>
        <li class="nav-item dropdown" v-if="!user">
          <a
            href="/login"
            class="nav-link navbar-text dropdown-toggle"
            data-toggle="dropdown"
            id="loginDropDown"
            @click.prevent="toggleLoginDropdown"
            >Login</a
          >
          <div id="login-dp" class="dropdown-menu dropdown-menu-right" aria-labelledby="dropdown-menu">
            <div class="row">
              <div class="col-md-12">
                Log in with
                <div class="social-buttons">
                  <b-button href="/api/account/auth/google" variant="google">Google</b-button>
                  <b-button href="/api/account/auth/discord" variant="discord">Discord</b-button>
                  <b-button href="/api/account/auth/facebook" variant="facebook">Facebook</b-button>
                </div>
                or
                <form
                  class="form mt-2"
                  role="form"
                  method="post"
                  action="/login"
                  @submit.prevent="login"
                  accept-charset="UTF-8"
                  id="login-nav"
                >
                  <div class="form-group">
                    <label class="sr-only" for="email">Email</label>
                    <input
                      type="email"
                      class="form-control"
                      id="email"
                      placeholder="Email address"
                      name="email"
                      v-model="email"
                      required
                    />
                  </div>
                  <div class="form-group">
                    <label class="sr-only" for="password">Password</label>
                    <input
                      type="password"
                      class="form-control"
                      id="password"
                      placeholder="Password"
                      name="password"
                      v-model="password"
                      required
                    />
                    <div class="help-block text-right mt-1">
                      <router-link to="/forgotten-password">Forgotten password ?</router-link>
                    </div>
                  </div>
                  <input type="hidden" name="referrer" value="<%= req.originalUrl %>" />
                  <div class="form-group">
                    <button type="submit" class="btn btn-primary btn-block">Log in</button>
                  </div>
                </form>
              </div>
              <div class="bottom text-center">
                New ? <router-link to="/signup"><b>Join us</b></router-link>
              </div>
            </div>
          </div>
        </li>
        <li class="nav-item" v-if="admin">
          <a class="nav-link" :href="adminLink" title="Admin" target="_blank">
            <b-icon-gear-fill />
            <span class="d-none d-md-inline ml-1">Admin</span>
          </a>
        </li>
        <li class="nav-item" v-if="user">
          <router-link class="nav-link" :to="`/user/${user.account.username}`" title="Account">
            <b-icon-person-fill />
            <span class="d-none d-md-inline ml-1">{{ user.account.username }}</span>
          </router-link>
        </li>
        <li class="nav-item" v-if="user">
          <a class="nav-link" href="/signout" @click.prevent="signout" title="Log out">
            <b-icon-power />
            <span class="d-none d-md-inline ml-1">Log out</span>
          </a>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from "vue-property-decorator";
import { handleError } from "@/utils";
import { User } from "@/types";

@Component({
  created(this: Navbar) {
    const unsubscribe = this.$store.subscribe(async ({ type, payload }) => {
      if (type === "updateUser") {
        if (this.user && !this.hasUser) {
          await this.refreshActiveGames();
        }
      }
    });

    this.$once("hook:beforeDestroy", unsubscribe);

    this.setActiveFavicon(this.activeGames.length > 0);
  },
})
export default class Navbar extends Vue {
  password = "";
  email = "";
  hasUser = false;
  firstRefresh = false;

  login() {
    this.$axios.post("/account/login", { email: this.email, password: this.password }).then(
      ({ data }) => {
        this.$store.dispatch("updateAuth", data);
        this.hideDropdown();
      },
      (err) => handleError(err)
    );
  }

  navbarClick() {
    this.$store.dispatch("logoClick");
  }

  signout() {
    this.$axios.post("/account/signout").then(
      () => {
        if (this.$route.meta.loggedIn) {
          this.$router.push("/");
        }
        this.$store.commit("updateUser", null);
      },
      (err) => handleError(err)
    );
  }

  hideDropdown() {
    document.getElementById("loginDropDown").click();
  }

  toggleLoginDropdown() {
    document.getElementById("login-dp").classList.toggle("show");
  }

  get user(): User {
    return this.$store.state.user;
  }

  get activeGames(): string[] {
    return this.$store.state.activeGames;
  }

  get admin(): boolean {
    return this.$store.getters.admin;
  }

  async refreshActiveGames() {
    if (!this.user) {
      return;
    }

    const user = this.user;
    this.hasUser = !!user;

    try {
      const activeGames = await this.$axios.get(`/user/${user._id}/games/current-turn`).then((r) => r.data);
      this.$store.commit(
        "activeGames",
        activeGames.map((game) => game._id)
      );
      this.$store.commit(
        "activeGames",
        activeGames.map((game) => game._id)
      );
    } catch (err) {
      handleError(err);
    }
  }

  isActiveFavicon() {
    return document.getElementById("favicon-site").getAttribute("href") === "/favicon-active.ico";
  }

  setActiveFavicon(active: boolean) {
    document.getElementById("favicon-site").setAttribute("href", active ? "/favicon-active.ico" : "/favicon.ico");
  }

  @Watch("activeGames")
  onActiveGamesChanged() {
    if (this.activeGames.length > 0) {
      if (!this.isActiveFavicon()) {
        this.setActiveFavicon(true);
        if (document.hidden) {
          if (this.user?.settings?.game?.soundNotification) {
            (document.getElementById("sound-notification") as HTMLAudioElement).play();
          }
          if (localStorage.getItem("notifications")) {
            new Notification("Boardgamers 🌌", { icon: "/favicon-active.ico", body: "It's your turn!" });
          }
        }
      }
    } else {
      this.setActiveFavicon(false);
    }
  }

  get adminLink() {
    if (location.hostname === "localhost") {
      return "http://localhost:8613"; // + "?refreshToken=" + this.$store.jwt.refreshToken.code
    } else {
      return `${location.protocol}//admin.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`; // + "?refreshToken=" + this.$store.jwt.refreshToken.code
    }
  }

  @Watch("user")
  onUserUpdated() {
    this.$ws.user = this.user;
  }
}
</script>

<style lang="scss">
@import "../stylesheets/main.scss";

#navbar {
  // Needed because safari bug?
  min-height: 56px;
}

#navbar a.nav-link.router-link-exact-active {
  color: $navbar-dark-active-color;
}

.navbar .nav-item .dropdown-menu {
  margin-top: 0.5rem;
  border-top-right-radius: 0;
  border-top-left-radius: 0;
}

#login-dp {
  min-width: 250px;
  padding: 14px 14px 0;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.8);
}
#login-dp .help-block {
  font-size: 12px;
}
#login-dp .bottom {
  background-color: rgba(255, 255, 255, 0.8);
  border-top: 1px solid #ddd;
  clear: both;
  padding: 14px;
}
#login-dp .social-buttons {
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  margin-top: 12px;
  margin-bottom: 4px;
}
#login-dp .social-buttons a {
  width: 46%;
  margin-bottom: 8px;
}
#login-dp .form-group {
  margin-bottom: 10px;
}

#active-game-count {
  border-radius: 50%;
  padding: 0.1rem 0.5rem;
}

@-moz-document url-prefix() {
  #active-game-count {
    margin-top: 0.1rem;
  }
}
</style>
