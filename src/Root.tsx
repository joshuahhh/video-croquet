import { startDrag } from '@engraft/shared/lib/drag.js';
import { useUpdateProxy } from '@engraft/update-proxy-react';
import { Mat, default as cv } from '@techstark/opencv-js';
import confetti from 'canvas-confetti';
import { ReactNode, memo, useCallback, useEffect, useState } from 'react';
import { Button } from './shadcn/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './shadcn/Select';
import { Slider } from './shadcn/Slider';
import useInterval from './useInterval';
import { rafLoop } from './rafLoop';
import { GiToyMallet } from 'react-icons/gi';


(window as any).confetti = confetti;

type Level = {
  credit: ReactNode,
  videoUrl: string,
  startTime: number,
  endTime: number,
  targets: [number, number][],
  solution?: [number, number],
};

const levels: Record<string, Level> = {
  shibuya: {
    credit: <>video by <a href='https://www.youtube.com/watch?v=_PLDxp_0yCo' className='text-blue-300'>Quarantine Tangerine</a></>,
    // videoUrl: 'shibuya.webm',
    videoUrl: 'shibuya-cut.webm',
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
  starlings: {
    credit: <>video by <a href='https://www.youtube.com/watch?v=V4f_1_r80RY' className='text-blue-300'>Jan van IJken</a></>,
    videoUrl: 'starlings-cut.webm',
    startTime: 0,
    endTime: 10,
    targets: [
      [976, 626],
      [656, 620],
    ],
    solution: [1058, 696],
  },
  bike: {
    credit: <>video by <a href='https://www.youtube.com/watch?v=R_JyDOIWHQk' className='text-blue-300'>Cam Engineering</a></>,
    videoUrl: 'bike-cut.webm',
    startTime: 0,
    endTime: 7,
    targets: [
      [1420, 596],
      [958, 492],
    ],
    solution: [1398, 442],
  },
  train: {
    credit: <>video by <a href='https://www.youtube.com/watch?v=or-IawxxrH4' className='text-blue-300'>cbt1960</a></>,
    // videoUrl: 'train.webm',
    videoUrl: 'train-cut.webm',
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
  clouds: {
    credit: <>video by <a href='https://www.youtube.com/watch?v=G_H3j8EZCvs' className='text-blue-300'>Videvo</a></>,
    videoUrl: 'clouds-cut.webm',
    startTime: 0,
    endTime: 10,
    targets: [
      [2400/2, 1224/2],
      [936/2, 1772/2],
    ],
    solution: [2904/2, 986/2],
  },
};

type LevelState =
  | {
      type: 'putting',
      puttPos: [number, number],
      lastBallInFlight: null | {
        ballTrace: [number, number][],
        hitTargets: Set<number>,
      },
    }
  | {
      type: 'in-flight',
      puttPos: [number, number],
      ballPos: [number, number] | null,
      ballTrace: [number, number][],
      hitTargets: Set<number>,
      prevImg: Mat | null,
    };

const intialLevelState: LevelState = {
  type: 'putting',
  puttPos: [1920/2, 1080/2],
  lastBallInFlight: null,
};

export const Root = memo(() => {
  const [ levelName, setLevelName ] = useState<keyof typeof levels>(Object.keys(levels)[0]);
  const level = levels[levelName];

  const [ videoElem, setVideoElem ] = useState<HTMLVideoElement | null>(null);
  const [ videoSize, setVideoSize ] = useState<[number, number] | null>(null);

  const [ currentTime, setCurrentTime ] = useState(0);

  const [ levelState, setLevelState ] = useState<LevelState>(intialLevelState);
  const levelStateUP = useUpdateProxy(setLevelState);

  useEffect(() => {
    (window as any).cheat = () => {
      levelStateUP.puttPos.$set(level.solution!);
    };
  }, [level.solution, levelStateUP]);

  // initialize video
  useEffect(() => {
    if (!videoElem) { return; }
    videoElem.currentTime = level.startTime;
  }, [level.startTime, videoElem]);

  useEffect(() => {
    return rafLoop(() => {
      if (!videoElem) { return; }
      setCurrentTime(videoElem.currentTime);
    });
  }, [videoElem]);

  useInterval(() => {
    try {
      if (!videoElem) { return; }
      if (levelState.type !== 'in-flight' || !levelState.ballPos) { return; }
      const inFlightUP = levelStateUP.$as<LevelState & { type: 'in-flight' }>();

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
      const criteria = new cv.TermCriteria(cv.TermCriteria_EPS | cv.TermCriteria_COUNT, 10, 0.03);
      cv.calcOpticalFlowPyrLK(prevImg, nextImg, prevPts, nextPts, st, err, winSize, maxLevel, criteria);
      prevImg.delete();

      if (st.rows === 0) {
        // we lost the ball
        inFlightUP.ballPos.$set(null);
      } else {
        const newPos: [number, number] = [nextPts.data32F[0], nextPts.data32F[1]];
        if (newPos[0] < 0 || newPos[1] < 0 || newPos[0] > videoElem.videoWidth || newPos[1] > videoElem.videoHeight) {
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
          if (levelState.hitTargets.size < level.targets.length && hitTargets.size === level.targets.length) {
            // console.log('confetti time');
            const videoRect = videoElem.getBoundingClientRect();
            const origin = {
              x: (videoRect.left + newPos[0] * videoElem.clientWidth / videoElem.videoWidth) / window.innerWidth,
              y: (videoRect.top + newPos[1] * videoElem.clientHeight / videoElem.videoHeight) / window.innerHeight,
            };
            // console.log(origin);
            confetti({ origin, particleCount: 100, spread: 360, scalar: 3, shapes: [
              confetti.shapeFromText({ text: '🏆' }),
            ] });
          }
        }
      }

      prevPts.delete();
      nextPts.delete();
    } catch (err) {
      if (typeof err === 'number') {
        throw new Error(cv.exceptionFromPtr(err).msg);
      } else {
        throw err;
      }
    }
  }, 1000 / 25);

  const switchToInFlightMode = useCallback(() => {
    if (levelState.type !== 'putting') { return; }
    const { puttPos } = levelState;
    if (!puttPos) { return; }
    setLevelState({
      type: 'in-flight',
      puttPos,
      ballPos: puttPos,
      ballTrace: [puttPos],
      hitTargets: new Set(),
      prevImg: null,
    });
    videoElem!.play();
  }, [levelState, videoElem]);

  const switchToPuttingMode = useCallback(() => {
    if (levelState.type !== 'in-flight') { return; }
    try {
      levelState.prevImg?.delete();
    } catch (err) {
      console.error(err);
    }
    const { puttPos, ballTrace, hitTargets } = levelState;
    setLevelState({
      type: 'putting',
      puttPos,
      lastBallInFlight: {
        ballTrace,
        hitTargets,
      },
    });
    videoElem!.currentTime = level.startTime;
    videoElem!.pause();
  }, [level.startTime, levelState, videoElem]);

  const resetIntoPuttingMode = useCallback((levelName: keyof typeof levels) => {
    setLevelState(intialLevelState);
    videoElem!.currentTime = levels[levelName].startTime;
    videoElem!.pause();
  }, [videoElem]);

  const [ svg, setSVG ] = useState<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svg) { return; }

    function onTouch(ev: TouchEvent) {
      if (ev.touches.length !== 1) { return; }
      ev.preventDefault();
      const touch = ev.touches[0];
      const rect = videoElem!.getBoundingClientRect();
      levelStateUP.puttPos.$set([
        (touch.clientX - rect.left) * videoElem!.videoWidth / videoElem!.clientWidth,
        (touch.clientY - rect.top - 50) * videoElem!.videoHeight / videoElem!.clientHeight,
      ]);
    }

    svg.addEventListener('touchstart', onTouch, { passive: false });
    svg.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      svg.removeEventListener('touchstart', onTouch);
      svg.removeEventListener('touchmove', onTouch);
    };
  }, [levelStateUP.puttPos, svg, videoElem]);

  return <div className='pt-6 px-3 flex flex-col items-center gap-8'>
    <h1 className='text-center text-4xl sm:text-5xl lg:text-8xl font-bold'>VIDEO CROQUET 3000</h1>
    <div className='w-64'>
      <Select
        value={levelName}
        onValueChange={(value) => {
          const levelName = value as keyof typeof levels;
          setLevelName(levelName);
          resetIntoPuttingMode(levelName);
          videoElem!.load();
        }}
      >
        <SelectTrigger className='text-xl'>
          <SelectValue/>
        </SelectTrigger>
        <SelectContent>
          {Object.keys(levels).map((name) =>
            <SelectItem key={name} value={name} className='text-xl'>{name}</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>

    <div className='flex flex-col items-end'>
      <div className='relative w-fit'>
        <video ref={setVideoElem} muted
          width={1920/2}
          height={1080/2}
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
          <source src={level.videoUrl} type='video/webm'/>
        </video>
        <svg className='absolute top-0 left-0' width='100%' height='100%'
          {...videoSize && {viewBox: `0 0 ${videoSize[0]} ${videoSize[1]}`}}
          onMouseMove={(ev) => {
            if ((window as any).descartes) {
              const rect = ev.currentTarget.getBoundingClientRect();
              const x = ev.clientX - rect.left;
              const y = ev.clientY - rect.top;
              console.log('mouse over', x * videoElem!.videoWidth / videoElem!.clientWidth, y * videoElem!.videoHeight / videoElem!.clientHeight);
            }
          }}
          ref={setSVG}
        >
          {/* TARGETS */}
          {level.targets.map(([x, y], i) => {
            let hit = levelState.type === 'in-flight'
              ? levelState.hitTargets.has(i)
              : levelState.lastBallInFlight?.hitTargets.has(i);

            return <circle key={i} cx={x} cy={y} r='20' fill={hit ? 'green' : 'black'} stroke='white' strokeWidth={4}/>;
          })}
          {/* WHEN IN FLIGHT: TRACE, ORIGINAL POSITION, FLYING BALL */}
          { levelState.type === 'in-flight' && <>
            <BallPath points={levelState.ballTrace}/>
            <circle cx={levelState.puttPos[0]} cy={levelState.puttPos[1]} r='10' fill='transparent' stroke='white' strokeWidth={4}/>
            { levelState.ballPos &&
              <Ball pos={levelState.ballPos}/>
            }
          </>}
          {/* WHEN PUTTING: OLD TRACE, DRAGGABLE BALL */}
          { levelState.type === 'putting' && <>
            { levelState.lastBallInFlight &&
              <BallPath points={levelState.lastBallInFlight.ballTrace}/>
            }
            <Ball pos={levelState.puttPos}
              className='cursor-move'
              onMouseDown={(ev) => {
                startDrag({
                  init() {
                    return { startX: levelState.puttPos[0], startY: levelState.puttPos[1] };
                  },
                  move({ startX, startY }) {
                    levelStateUP.puttPos.$set([
                      startX + this.startDeltaX * videoElem!.videoWidth / videoElem!.clientWidth,
                      startY + this.startDeltaY * videoElem!.videoHeight / videoElem!.clientHeight,
                    ]);
                  },
                  done() {},
                  keepCursor: true,
                })(ev as any);
              }}
            />
          </>}
        </svg>
        <Slider
          min={level.startTime} max={level.endTime} step={0.001}
          value={[currentTime]}
          disabled={true}
          // onValueChange={(newValue) => {
          //   if (videoElem) {
          //     console.log('onValueChange', newValue[0], videoElem.currentTime);
          //     videoElem.currentTime = newValue[0];
          //     setCurrentTime(newValue[0]);
          //   }
          // }}
        />
      </div>
      <div>
        {level.credit}
      </div>
    </div>
    <div className='py-4'>
      { levelState.type === 'putting' &&
        <Button onClick={switchToInFlightMode} className='text-3xl'><GiToyMallet className='mr-2'/> putt</Button>
      }
      { levelState.type === 'in-flight' &&
        <Button onClick={switchToPuttingMode} className='text-3xl'>reset</Button>
      }
    </div>
    <div className='opacity-80'>
      made by <a href='https://joshuahhh.com/' className='text-blue-300'>josh</a> for plse game jam 2024 {'<3'}
    </div>
  </div>;
});


function Ball(props: React.SVGAttributes<SVGGElement> & {
  pos: [number, number],
}) {
  const { pos, ...rest } = props;

  return <g transform={`translate(${pos[0]}, ${pos[1]})`} {...rest}>
    <mask id='ball-mask'>
      <rect x={-50} y={-50} width='100' height='100' fill='white'/>
      <circle cx={0} cy={0} r='30' fill='rgba(0,0,0,80%)'/>
    </mask>
    <image href='ball.png' x={-50} y={-50} width='100' height='100' mask='url(#ball-mask)' style={{
      // boxShadow: '0 0 10px 5px white',
    }}/>
  </g>;
}

function BallPath(props: {
  points: [number, number][],
}) {
  const { points } = props;

  return <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} strokeDasharray='10,5'
    fill='none' stroke='blue' strokeWidth='5'
  />;
}

function toGray(src: Mat) {
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
  return gray;
}

function htmlToMat(src: HTMLVideoElement | HTMLCanvasElement) {
  let canvas: HTMLCanvasElement;
  if (src instanceof HTMLVideoElement) {
    canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [src.videoWidth, src.videoHeight];
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
  } else {
    canvas = src;
  }

  return cv.imread(canvas);
}

export default function dims(source: HTMLVideoElement | HTMLCanvasElement) {
  if (source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  } else {
    return [source.width, source.height];
  }
}


// function getTypeString(type: number): string {
//     const imgTypeInt = type % 8;

//     let imgTypeString = ['8U', '8S', '16U', '16S', '32S', '32F', '64F'][imgTypeInt];

//     const channel = Math.floor(type / 8) + 1;

//     return `CV_${imgTypeString}C${channel}`;
// }
