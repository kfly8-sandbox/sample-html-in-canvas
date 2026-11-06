// Entry for frames.html.
import animHtml from "../../../experiments/04-frames/anim.html?raw";

import { setupFrames } from "../frames";
import { guard } from "../hic";

if (guard()) void setupFrames(document.getElementById("demo")!, animHtml);
