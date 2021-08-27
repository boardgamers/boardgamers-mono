# Introduction

BGS is a platform able to dynamically load and update boardgame implementations. For that each boardgame must expose two relatively simple APIs, one for the UI and one for the game engine.

BGS also has its own modules to have a standard way to implement engines - and soon UIs, with many inspirations including from [boardgame.io](https://boardgame.io), but they are entirely optional. They're just here to help, but as long as you implement a wrapper for the API, you can code your engine however you like.

The games on BGS are completely **open source**, and you can look at their code for inspiration.
