import { Net } from "./net";
import { startOnline } from "./online";
import { startSandbox } from "./sandbox";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const params = new URLSearchParams(location.search);
const net = new Net();

if (params.has("sandbox")) startSandbox(canvas, net);
else startOnline(canvas, net, params.get("room"));

net.start();
