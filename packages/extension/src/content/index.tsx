// Entry for the content script. The legacy vanilla world loads first (it
// self-guards against double injection and shrinks as Asgard's islands land),
// then Heimdall raises Asgard's shadow root.
import "../content.js";
import { boot } from "./heimdall";

boot();
