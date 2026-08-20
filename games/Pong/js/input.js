const down = new Set();
const just = new Set();

const bind = {
  up: ["KeyW", "ArrowUp", "KeyZ"],
  down: ["KeyS", "ArrowDown"],
  altup: ["KeyA", "KeyQ", "ArrowLeft"],
  altdown: ["KeyD", "ArrowRight"],
  power: ["Space"],
  switch: ["KeyE"],
  pause: ["Escape", "KeyP"],
  confirm: ["Enter", "Space"]
};

function any(keys) {
  return keys.some((k) => down.has(k));
}
function anyJust(keys) {
  return keys.some((k) => just.has(k));
}
function axisFrom(neg, pos) {
  let v = 0;
  if (any(neg)) v -= 1;
  if (any(pos)) v += 1;
  return v;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export const input = {
  axis: 0,
  axis2: 0,
  axisJustUp: false,
  axisJustDown: false,
  axisJustAltUp: false,
  axisJustAltDown: false,
  power: false,
  powerHeld: false,
  switch: false,
  pause: false,
  confirm: false,
  anyKey: false,

  attach() {
    window.addEventListener("keydown", (e) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }
      if (!down.has(e.code)) just.add(e.code);
      down.add(e.code);
      this.anyKey = true;
    });
    window.addEventListener("keyup", (e) => down.delete(e.code));
    window.addEventListener("blur", () => down.clear());
  },

  snapshot() {
    return {
      axis: this.axis,
      axis2: this.axis2,
      power: this.power,
      powerHeld: this.powerHeld,
      switch: this.switch
    };
  },

  update() {
    const a = clamp(axisFrom(bind.up, bind.down), -1, 1);
    const a2 = clamp(axisFrom(bind.altup, bind.altdown), -1, 1);
    this.axisJustUp = this.axis === 0 && a < 0;
    this.axisJustDown = this.axis === 0 && a > 0;
    this.axisJustAltUp = this.axis2 === 0 && a2 < 0;
    this.axisJustAltDown = this.axis2 === 0 && a2 > 0;
    this.axis = a;
    this.axis2 = a2;
    this.power = anyJust(bind.power);
    this.powerHeld = any(bind.power);
    this.switch = anyJust(bind.switch);
    this.pause = anyJust(bind.pause);
    this.confirm = anyJust(bind.confirm);
  },

  endFrame() {
    just.clear();
    this.anyKey = false;
    this.pause = false;
    this.confirm = false;
    this.power = false;
    this.switch = false;
    this.axisJustUp = false;
    this.axisJustDown = false;
    this.axisJustAltUp = false;
    this.axisJustAltDown = false;
  }
};
