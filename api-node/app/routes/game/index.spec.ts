import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { ObjectId } from "bson";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import mongoose from "mongoose";
import env from "../../config/env";
import { Game, GameInfo, GamePreferences, JwtRefreshToken, User } from "../../models";

chai.use(chaiAsPromised);

describe("Game API", () => {
  const userId = new ObjectId();
  let axiosConfig: AxiosRequestConfig = {};

  before(async () => {
    await User.create({
      _id: userId,
      account: { username: "test", email: "test@test.com" },
      security: { confirmed: true },
    });
    await GameInfo.create({
      _id: {
        game: "test",
        version: 1,
      },
      label: "Test",
      viewer: {
        url: "//test.com/test",
        topLevelVariable: "test",
      },
      players: [2],

      meta: {
        public: true,
      },
    });
    const refresh = await JwtRefreshToken.create({ user: userId });
    const token = await refresh.createAccessToken(["all"], false);
    axiosConfig = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      baseURL: `http://localhost:${env.listen.port.api}`,
    };
  });

  it("should not be able to create a game without ownership", async () => {
    const createP = axios.post(
      "/api/game/new-game",
      {
        gameId: "test",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 2,
        options: { join: true },
      },
      axiosConfig
    );

    const err: AxiosError = await createP.then(
      (err) => Promise.reject(err),
      (err) => err
    );
    expect(err.response.data?.message.includes("own the game")).to.be.true;
  });

  it("should be able to create a game with ownership", async () => {
    await GamePreferences.create({
      user: userId,
      game: "test",
      access: {
        ownership: true,
      },
    });

    const createP = axios.post(
      "/api/game/new-game",
      {
        gameId: "test",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 2,
        options: { join: true },
      },
      axiosConfig
    );

    await expect(createP).to.be.fulfilled;
  });

  it("should not be able to create a game with the wrong number of players", async () => {
    const createP = axios.post(
      "/api/game/new-game",
      {
        gameId: "test-fail",
        game: { game: "test", version: 1 },
        timePerMove: 5000,
        timePerGame: 5000,
        players: 3,
        options: { join: true },
      },
      axiosConfig
    );

    const err: AxiosError = await createP.then(
      (err) => Promise.reject(err),
      (err) => err
    );
    expect(err.response.data?.message).to.equal("Wrong number of players");
  });

  // it ("should not be able to create a game without the join option", async () => {
  //   const createP = axios.post('/api/game/new-game', {
  //     gameId: "test-fail2",
  //     game: {game: "test", version: 1},
  //     timePerMove: 5000,
  //     timePerGame: 5000,
  //     players: 2
  //   },
  //     axiosConfig
  //   );

  //   const err: AxiosError = await createP.then(err => Promise.reject(err.data), err => err);
  //   expect(err.response.data?.message).to.equal("You need special authorization to create games without joining them!");
  // });

  it("should be able to leave the game", async () => {
    const unjoinP = axios.post("/api/game/test/unjoin", {}, axiosConfig);

    await expect(unjoinP).to.be.fulfilled;

    expect(await Game.countDocuments({ _id: "test" })).to.equal(0, "Game should be deleted after creator unjoins");
  });

  after(() => mongoose.connection.db.dropDatabase());
});
