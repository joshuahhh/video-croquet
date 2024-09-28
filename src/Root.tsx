import { startDrag } from "@engraft/shared/lib/drag.js";
import { useUpdateProxy } from "@engraft/update-proxy-react";
import { Mat, default as cv } from "@techstark/opencv-js";
import confetti from "canvas-confetti";
import { path as d3path } from "d3-path";
import {
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { rafLoop } from "./rafLoop";
import { Button } from "./shadcn/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./shadcn/Select";
import { Slider } from "./shadcn/Slider";
import useInterval from "./useInterval";

(window as any).confetti = confetti;

type Level = {
  name: string;
  credit: ReactNode;
  videoUrl: string;
  startTime: number;
  endTime: number;
  targets: [number, number][];
  solution?: [number, number];
};

const levels: Level[] = [
  {
    name: "shibuya",
    credit: (
      <>
        video by{" "}
        <a
          href="https://www.youtube.com/watch?v=_PLDxp_0yCo"
          className="text-blue-300"
        >
          Quarantine Tangerine
        </a>
      </>
    ),
    // videoUrl: 'shibuya.webm',
    videoUrl: "shibuya-cut.webm",
    // startTime: 7,
    // endTime: 17,
    startTime: 0,
    endTime: 10,
    targets: [
      [1208, 520],
      [1312, 738],
    ],
    solution: [1170, 428],
  },
  {
    name: "starlings",
    credit: (
      <>
        video by{" "}
        <a
          href="https://www.youtube.com/watch?v=V4f_1_r80RY"
          className="text-blue-300"
        >
          Jan van IJken
        </a>
      </>
    ),
    videoUrl: "starlings-cut.webm",
    startTime: 0,
    endTime: 10,
    targets: [
      [976, 626],
      [656, 620],
    ],
    solution: [1058, 696],
  },
  {
    name: "bike",
    credit: (
      <>
        video by{" "}
        <a
          href="https://www.youtube.com/watch?v=R_JyDOIWHQk"
          className="text-blue-300"
        >
          Cam Engineering
        </a>
      </>
    ),
    videoUrl: "bike-cut.webm",
    startTime: 0,
    endTime: 7,
    targets: [
      [1420, 596],
      [958, 492],
    ],
    solution: [1398, 442],
  },
  {
    name: "train",
    credit: (
      <>
        video by{" "}
        <a
          href="https://www.youtube.com/watch?v=or-IawxxrH4"
          className="text-blue-300"
        >
          cbt1960
        </a>
      </>
    ),
    // videoUrl: 'train.webm',
    videoUrl: "train-cut.webm",
    // startTime: 150,
    // endTime: 160,
    startTime: 0,
    endTime: 10,
    targets: [
      [490, 266],
      [1306, 256],
    ],
    solution: [988, 264],
  },
  {
    name: "clouds",
    credit: (
      <>
        video by{" "}
        <a
          href="https://www.youtube.com/watch?v=G_H3j8EZCvs"
          className="text-blue-300"
        >
          Videvo
        </a>
      </>
    ),
    videoUrl: "clouds-cut.webm",
    startTime: 0,
    endTime: 10,
    targets: [
      [2400 / 2, 1224 / 2],
      [936 / 2, 1772 / 2],
    ],
    solution: [2904 / 2, 986 / 2],
  },
];

type LevelState =
  | {
      type: "putting";
      puttPos: [number, number];
      lastBallInFlight: null | {
        ballTrace: [number, number][];
        hitTargets: Set<number>;
      };
      isDragging: boolean;
    }
  | {
      type: "in-flight";
      puttPos: [number, number];
      ballPos: [number, number] | null;
      ballTrace: [number, number][];
      hitTargets: Set<number>;
      prevImg: Mat | null;
    };

const intialLevelState: LevelState = {
  type: "putting",
  puttPos: [1920 / 2, 1080 / 2],
  lastBallInFlight: null,
  isDragging: false,
};

export const Root = memo(() => {
  const [levelIdx, setLevelIdx] = useState<number>(0);
  const level = levels[levelIdx];

  const [passedLevel, setPassedLevel] = useState<boolean>(false);

  const [videoElem, setVideoElem] = useState<HTMLVideoElement | null>(null);
  const [videoSize, setVideoSize] = useState<[number, number] | null>(null);

  const [currentTime, setCurrentTime] = useState(0);

  const [levelState, setLevelState] = useState<LevelState>(intialLevelState);
  const levelStateUP = useUpdateProxy(setLevelState);

  const [secretMode, setSecretMode] = useState(false);

  useEffect(() => {
    (window as any).cheat = () => {
      levelStateUP.puttPos.$set(level.solution!);
    };
  }, [level.solution, levelStateUP]);

  // initialize video
  useEffect(() => {
    if (!videoElem) {
      return;
    }
    videoElem.currentTime = level.startTime;
  }, [level.startTime, videoElem]);

  useEffect(() => {
    return rafLoop(() => {
      if (!videoElem) {
        return;
      }
      setCurrentTime(videoElem.currentTime);
    });
  }, [videoElem]);

  useInterval(() => {
    try {
      if (!videoElem) {
        return;
      }
      if (levelState.type !== "in-flight" || !levelState.ballPos) {
        return;
      }
      const inFlightUP = levelStateUP.$as<LevelState & { type: "in-flight" }>();

      const nextImgColor = htmlToMat(videoElem);
      const nextImg = toGray(nextImgColor);
      nextImgColor.delete();
      const prevImg = levelState.prevImg;
      if (!prevImg) {
        inFlightUP.prevImg.$set(nextImg);
        return;
      }
      inFlightUP.prevImg.$set(nextImg);

      const prevPts = cv.matFromArray(1, 2, cv.CV_32F, levelState.ballPos);
      const nextPts = new cv.Mat();

      const st = new cv.Mat();
      const err = new cv.Mat();
      const winSize = new cv.Size(15, 15);
      const maxLevel = 2;
      const criteria = new cv.TermCriteria(
        cv.TermCriteria_EPS | cv.TermCriteria_COUNT,
        10,
        0.03,
      );
      cv.calcOpticalFlowPyrLK(
        prevImg,
        nextImg,
        prevPts,
        nextPts,
        st,
        err,
        winSize,
        maxLevel,
        criteria,
      );
      prevImg.delete();

      if (st.rows === 0) {
        // we lost the ball
        inFlightUP.ballPos.$set(null);
      } else {
        const newPos: [number, number] = [
          nextPts.data32F[0],
          nextPts.data32F[1],
        ];
        if (
          newPos[0] < 0 ||
          newPos[1] < 0 ||
          newPos[0] > videoElem.videoWidth ||
          newPos[1] > videoElem.videoHeight
        ) {
          // we lost the ball
          inFlightUP.ballPos.$set(null);
        } else {
          inFlightUP.ballPos.$set(newPos);
          inFlightUP.ballTrace.$((old) => [...old, newPos]);

          const hitTargets = new Set(levelState.hitTargets);
          for (const [i, [x, y]] of level.targets.entries()) {
            if (Math.hypot(newPos[0] - x, newPos[1] - y) < 20) {
              hitTargets.add(i);
            }
          }
          inFlightUP.hitTargets.$set(hitTargets);
          if (
            levelState.hitTargets.size < level.targets.length &&
            hitTargets.size === level.targets.length
          ) {
            setPassedLevel(true);
            const videoRect = videoElem.getBoundingClientRect();
            const origin = {
              x:
                (videoRect.left +
                  (newPos[0] * videoElem.clientWidth) / videoElem.videoWidth) /
                window.innerWidth,
              y:
                (videoRect.top +
                  (newPos[1] * videoElem.clientHeight) /
                    videoElem.videoHeight) /
                window.innerHeight,
            };
            confetti({
              origin,
              particleCount: 100,
              spread: 360,
              scalar: 3,
              shapes: [confetti.shapeFromText({ text: "🏆" })],
              startVelocity: 10,
              gravity: 0.3,
            });
          }
        }
      }

      prevPts.delete();
      nextPts.delete();
    } catch (err) {
      if (typeof err === "number") {
        throw new Error(cv.exceptionFromPtr(err).msg);
      } else {
        throw err;
      }
    }
  }, 1000 / 60);

  const switchToInFlightMode = useCallback(() => {
    if (levelState.type !== "putting") {
      return;
    }
    const { puttPos } = levelState;
    if (!puttPos) {
      return;
    }
    setLevelState({
      type: "in-flight",
      puttPos,
      ballPos: puttPos,
      ballTrace: [puttPos],
      hitTargets: new Set(),
      prevImg: null,
    });
    videoElem!.play();
  }, [levelState, videoElem]);

  const switchToPuttingMode = useCallback(() => {
    if (levelState.type !== "in-flight") {
      return;
    }
    try {
      levelState.prevImg?.delete();
    } catch (err) {
      console.error(err);
    }
    const { puttPos, ballTrace, hitTargets } = levelState;
    setLevelState({
      type: "putting",
      puttPos,
      lastBallInFlight: {
        ballTrace,
        hitTargets,
      },
      isDragging: false,
    });
    videoElem!.currentTime = level.startTime;
    videoElem!.pause();
  }, [level.startTime, levelState, videoElem]);

  const resetIntoPuttingMode = useCallback(
    (levelIdx: number) => {
      setLevelState(intialLevelState);
      videoElem!.currentTime = levels[levelIdx].startTime;
      videoElem!.pause();
    },
    [videoElem],
  );

  const [svg, setSVG] = useState<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svg) {
      return;
    }

    function onTouch(ev: TouchEvent) {
      if (ev.touches.length !== 1) {
        return;
      }
      ev.preventDefault();
      const touch = ev.touches[0];
      const rect = videoElem!.getBoundingClientRect();
      levelStateUP.puttPos.$set([
        ((touch.clientX - rect.left) * videoElem!.videoWidth) /
          videoElem!.clientWidth,
        ((touch.clientY - rect.top - 50) * videoElem!.videoHeight) /
          videoElem!.clientHeight,
      ]);
    }

    svg.addEventListener("touchstart", onTouch, { passive: false });
    svg.addEventListener("touchmove", onTouch, { passive: false });
    return () => {
      svg.removeEventListener("touchstart", onTouch);
      svg.removeEventListener("touchmove", onTouch);
    };
  }, [levelStateUP.puttPos, svg, videoElem]);

  const targetAngle = useMemo(() => {
    // find the closest target to the ball
    let minDist = Infinity;
    let targetAngle = 0;
    for (const [x, y] of level.targets) {
      const dist = Math.hypot(
        levelState.puttPos[0] - x,
        levelState.puttPos[1] - y,
      );
      if (dist < minDist) {
        minDist = dist;
        const targetAngleRadians = Math.atan2(
          y - levelState.puttPos[1],
          x - levelState.puttPos[0],
        );
        // convert to 0-360
        targetAngle =
          ((targetAngleRadians + Math.PI * 2) * (180 / Math.PI)) % 360;
      }
    }
    return targetAngle;
  }, [level.targets, levelState.puttPos]);

  return (
    <div
      className="flex flex-col items-center overflow-hidden w-full h-full"
      onClick={() => {
        if (levelState.type === "in-flight") {
          switchToPuttingMode();
        }
      }}
    >
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 bg-[rgb(90,145,213)]" />
        <div id="BACKGROUND" className="relative">
          <div id="GAME" className="absolute top-[17%] left-[16%] w-[60%]">
            <video
              ref={setVideoElem}
              muted
              width="100%"
              onTimeUpdate={(ev) => {
                const video = ev.currentTarget;
                if (video.currentTime >= level.endTime) {
                  switchToPuttingMode();
                }
              }}
              onCanPlay={(ev) => {
                const video = ev.currentTarget;
                setVideoSize([video.videoWidth, video.videoHeight]);
              }}
            >
              <source src={level.videoUrl} type="video/webm" />
            </video>
            <svg
              className="absolute top-0 left-0"
              width="100%"
              height="100%"
              {...(videoSize && {
                viewBox: `0 0 ${videoSize[0]} ${videoSize[1]}`,
              })}
              onMouseMove={(ev) => {
                if ((window as any).descartes) {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const x = ev.clientX - rect.left;
                  const y = ev.clientY - rect.top;
                  console.log(
                    "mouse over",
                    (x * videoElem!.videoWidth) / videoElem!.clientWidth,
                    (y * videoElem!.videoHeight) / videoElem!.clientHeight,
                  );
                }
              }}
              ref={setSVG}
            >
              {/* TARGETS */}
              {level.targets.map(([x, y], i) => {
                let hit =
                  levelState.type === "in-flight"
                    ? levelState.hitTargets.has(i)
                    : (levelState.lastBallInFlight?.hitTargets.has(i) ?? false);

                return <Target key={i} x={x} y={y} hit={hit} />;
              })}
              {/* WHEN IN FLIGHT: TRACE, ORIGINAL POSITION, FLYING BALL */}
              {levelState.type === "in-flight" && (
                <>
                  <BallPath points={levelState.ballTrace} />
                  <circle
                    cx={levelState.puttPos[0]}
                    cy={levelState.puttPos[1]}
                    r="10"
                    fill="transparent"
                    stroke="white"
                    strokeWidth={4}
                  />
                  {levelState.ballPos && (
                    <Ball
                      pos={levelState.ballPos}
                      rotate={
                        (levelState.ballPos[0] - levelState.ballTrace[0][0]) *
                        0.2
                      }
                      malletAttr={{
                        className: "hidden",
                      }}
                      targetAngle={targetAngle}
                    />
                  )}
                </>
              )}
              {/* WHEN PUTTING: OLD TRACE, DRAGGABLE BALL */}
              {levelState.type === "putting" && (
                <>
                  {levelState.lastBallInFlight && (
                    <BallPath points={levelState.lastBallInFlight.ballTrace} />
                  )}
                  <Ball
                    pos={levelState.puttPos}
                    ballAttr={{
                      className: "cursor-move",
                      onMouseDown: (ev) => {
                        startDrag({
                          init() {
                            levelStateUP.isDragging.$set(true);
                            return {
                              startX: levelState.puttPos[0],
                              startY: levelState.puttPos[1],
                            };
                          },
                          move({ startX, startY }) {
                            levelStateUP.puttPos.$set([
                              startX +
                                (this.startDeltaX * videoElem!.videoWidth) /
                                  videoElem!.clientWidth,
                              startY +
                                (this.startDeltaY * videoElem!.videoHeight) /
                                  videoElem!.clientHeight,
                            ]);
                          },
                          done() {
                            levelStateUP.isDragging.$set(false);
                          },
                          keepCursor: true,
                        })(ev as any);
                      },
                    }}
                    malletAttr={{
                      onClick: switchToInFlightMode,
                      className: `cursor-pointer transition duration-200 ${
                        levelState.isDragging ? "opacity-20" : "opacity-100"
                      }`,
                    }}
                    targetAngle={targetAngle}
                  />
                </>
              )}
            </svg>
          </div>
          <img
            src="background.png"
            alt=""
            className="relative aspect-[1.3] w-full pointer-events-none"
          />
          <div className="absolute bottom-[35%] left-[13%] right-[22.5%]">
            <Slider
              min={level.startTime}
              max={level.endTime}
              step={0.001}
              value={[currentTime]}
              disabled={true}
            />
          </div>
          {secretMode && (
            <>
            <div
              className="w-40 absolute right-[11.5%] top-[14%]"
              style={{ transform: "translate(50%)" }}
            >
              <Select
                value={"" + levelIdx}
                onValueChange={(value) => {
                  const levelIdx = +value;
                  setLevelIdx(levelIdx);
                  setPassedLevel(false);
                  resetIntoPuttingMode(levelIdx);
                  videoElem!.load();
                }}
              >
                <SelectTrigger className="text-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((level, idx) => (
                      <SelectItem
                        key={idx}
                        value={"" + idx}
                        className="text-xl"
                      >
                      {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              </div>
              {level.solution && (
                <div
                  className="absolute right-[11.5%] top-[18%]"
                  style={{ transform: "translate(50%)" }}
                >
                  <Button
                    variant="destructive"
                    className="text-2xl"
                    onClick={() => {
                      levelStateUP.puttPos.$set(level.solution!);
                    }}
                  >
                    cheat
                  </Button>
            </div>
              )}
            </>
          )}
          <div
            className="absolute right-[11.5%] top-[61%]"
            style={{ transform: "translate(50%)" }}
          >
            {passedLevel && (
              <Button
                variant="secondary"
                onClick={() => {
                  const newIdx = (levelIdx + 1) % levels.length;
                  setLevelIdx(newIdx);
                  setPassedLevel(false);
                  resetIntoPuttingMode(newIdx);
                  videoElem!.load();
                }}
                className="text-3xl"
              >
                {levelIdx === levels.length - 1
                  ? "back to start"
                  : "next level"}
              </Button>
            )}
          </div>
          <div
            className="absolute left-[0.8%] top-[69%] w-5 h-5"
            style={{ transform: "translate(-50%, -50%)" }}
            onClick={() => {
              setSecretMode((prev) => !prev);
            }}
          />
          <h1 className="text-center text-7xl font-bold fixed left-0 right-0 top-3">
            VIDEO CROQUET 3000
          </h1>
          {/* <div className="fixed left-0 right-0 bottom-0 text-center py-4">
            {levelState.type === "putting" && (
              <Button onClick={switchToInFlightMode} className="text-3xl">
                <GiToyMallet className="mr-2" /> putt
              </Button>
            )}
            {levelState.type === "in-flight" && (
              <Button onClick={switchToPuttingMode} className="text-3xl">
                reset
              </Button>
            )}
          </div> */}
        </div>
        <div className="flex-1 bg-[rgb(91,132,45)]" />
      </div>
    </div>
  );
});

const s = 20;
const arc = 10;
const targetPath = d3path();
targetPath.moveTo(-s, s);
targetPath.lineTo(-s, -s + arc);
targetPath.arc(-s + arc, -s + arc, arc, Math.PI, (3 * Math.PI) / 2);
targetPath.lineTo(s - arc, -s);
targetPath.arc(s - arc, -s + arc, arc, (3 * Math.PI) / 2, 0);
targetPath.lineTo(s, s);
// targetPath.closePath();
const targetPathD = targetPath.toString();

function Target(props: { x: number; y: number; hit: boolean }) {
  const { x, y, hit } = props;
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* <circle r='20' fill={hit ? 'green' : 'black'} stroke='white' strokeWidth={4}/> */}
      <path
        d={targetPathD}
        stroke="black"
        fill="none"
        strokeWidth={16}
        strokeLinecap="square"
      />
      <path
        d={targetPathD}
        stroke={hit ? "rgb(135,178,81)" : "white"}
        fill="none"
        strokeWidth={8}
        strokeLinecap="square"
      />
    </g>
  );
}

function Ball(props: {
  pos: [number, number];
  rotate?: number;
  ballAttr?: React.SVGAttributes<SVGImageElement>;
  malletAttr?: React.SVGAttributes<SVGImageElement>;
  targetAngle: number;
}) {
  const { pos, rotate = 0, targetAngle, ballAttr, malletAttr } = props;

  const lastMalletAngleRef = useRef<number | null>(null);

  const ballR = 40;
  const maskR = ballR * 0.8;

  const targetAngleFromTop = (targetAngle + 270) % 360;

  const { malletAngle1, shouldFlipMallet } =
    0 <= targetAngleFromTop && targetAngleFromTop < 180
      ? { malletAngle1: targetAngleFromTop, shouldFlipMallet: true }
      : {
          malletAngle1: targetAngleFromTop,
          shouldFlipMallet: false,
        };

  // set malletAngle to the the version of malletAngle1 closest to
  // lastMalletAngle (to avoid flipping)

  const malletAngle = lastMalletAngleRef.current
    ? ((malletAngle1 - lastMalletAngleRef.current + 180) % 360) -
      180 +
      lastMalletAngleRef.current
    : malletAngle1;

  lastMalletAngleRef.current = malletAngle;

  return (
    <g transform={`translate(${pos[0]}, ${pos[1]}) rotate(${rotate})`}>
      <radialGradient id="ball-mask-gradient">
        <stop offset="50%" stop-color="rgba(0,0,0,90%)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0%)" />
      </radialGradient>
      <mask id="ball-mask">
        <rect
          x={-ballR}
          y={-ballR}
          width={2 * ballR}
          height={2 * ballR}
          fill="white"
        />
        <circle
          cx={0}
          cy={0}
          r={maskR}
          fill="url(#ball-mask-gradient)"
          // fill="rgba(0,0,0,80%)"
        />
      </mask>
      <image
        href="ball.png"
        x={-ballR}
        y={-ballR}
        width={2 * ballR}
        height={2 * ballR}
        mask="url(#ball-mask)"
        {...ballAttr}
      />
      <circle
        cy={1}
        r={ballR}
        fill="transparent"
        stroke="rgba(255,255,255,50%)"
        strokeWidth={1}
        style={{ pointerEvents: "none" }}
      />
      <g transform={`rotate(${malletAngle})`}>
        <g
          className="transition duration-500"
          transform={`scale(${shouldFlipMallet ? -1 : 1}, 1) rotate(45)`}
        >
          <image
            href="mallet-bw.png"
            x={-120}
            y={-170}
            width="140"
            height="140"
            {...malletAttr}
          />
        </g>
      </g>
    </g>
  );
}

function BallPath(props: { points: [number, number][] }) {
  const { points } = props;

  return (
    <polyline
      points={points.map(([x, y]) => `${x},${y}`).join(" ")}
      strokeDasharray="10,5"
      fill="none"
      stroke="blue"
      strokeWidth="5"
    />
  );
}

function toGray(src: Mat) {
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
  return gray;
}

function htmlToMat(src: HTMLVideoElement | HTMLCanvasElement) {
  let canvas: HTMLCanvasElement;
  if (src instanceof HTMLVideoElement) {
    canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [src.videoWidth, src.videoHeight];
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
  } else {
    canvas = src;
  }

  return cv.imread(canvas);
}

// function dims(source: HTMLVideoElement | HTMLCanvasElement) {
//   if (source instanceof HTMLVideoElement) {
//     return [source.videoWidth, source.videoHeight];
//   } else {
//     return [source.width, source.height];
//   }
// }

// function getTypeString(type: number): string {
//     const imgTypeInt = type % 8;

//     let imgTypeString = ['8U', '8S', '16U', '16S', '32S', '32F', '64F'][imgTypeInt];

//     const channel = Math.floor(type / 8) + 1;

//     return `CV_${imgTypeString}C${channel}`;
// }
