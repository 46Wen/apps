'use strict';
/**
 * engine.js - Copiloto de voz: when something happens in the car, which phrase to say. Plain logic, no I/O, so it can
 * be tested off the car (tools/test_copiloto_voz.js) with a clock of its own. Node 8 (the car's 8.16.2).
 *
 * Fed with what the car sends:
 *   condition(n)   VehicleCondition.statusConditionVehicle as a number (kit/runtime/car.js conditionOf):
 *                  1-3 parked / nobody in the car, 5 living (no ignition), 7 ignition on, 8 drive readiness starting,
 *                  10 drive-ready (FAHREN), 12 drive readiness ending
 *   doors(list)    the doors open now (names), from DoorsWindowsRoofMirrors.CentralLockingSystemAndPanelStatus
 *   fuel(litres, rangeKm)   KombiIF statusRangeTankStatus
 *   outside(c)     EnvironmentalInformation.ExteriorTemperature, deg C
 * and tick() every few seconds. It calls say(event, info) with one of EVENTS.
 */

const EVENTS = ['bienvenida', 'fin_viaje', 'combustible', 'repostado', 'hielo', 'descanso'];

const DEFAULTS = {
    fuelKm: 50,             // range at or under which "combustible" is said
    fuelRearmKm: 30,        // ... said again only after the range was this much above fuelKm (a refuel)
    refuelLitres: 8,        // litres more than the lowest seen since the last refuel: "repostado"
    iceC: 3,                // outside at or under this while driving: "hielo", once a trip
    breakMs: 2 * 3600000,   // driving this long without stopping: "descanso", then again after as long
    stopResetsBreakMs: 15 * 60000, // a stop this long (not drive-ready) starts the break count again
    minTripMs: 60000,       // a trip shorter than this says no "fin_viaje" (a restart, moving the car)
    tripEndRearmMs: 15 * 60000,    // after "fin_viaje", the welcome comes back after this long ...
    iceAfterMs: 60000,      // "hielo" not in the first minute of a trip (the sensor warms up in a garage)
};

const isNum = (v) => typeof v === 'number' && isFinite(v);
const DRIVING = 10;
const LEFT = 3;           // 3 and lower: parked, nobody in the car -> the welcome comes back

class Engine {
    constructor(opts) {
        opts = opts || {};
        this.now = opts.now || Date.now;
        this.say = opts.say || (() => {});
        this.enabled = opts.enabled || (() => true);       // enabled(event) -> bool (the settings)
        this.cfg = Object.assign({}, DEFAULTS, opts.cfg || {});
        this.log = opts.log || (() => {});
        this.cond = null;
        this.doorsOpen = [];
        this.welcomeArmed = true;     // a fresh start of the head unit: someone is getting in
        this.tripStart = null;        // when drive-ready began (null: not driving)
        this.tripEndAt = null;        // when the last "fin_viaje" was said
        this.stoppedAt = null;        // when drive-ready last ended (for the break count)
        this.driveMs = 0;             // driving time counted for "descanso"
        this.lastTick = null;
        this.breakSaid = 0;           // how many "descanso" were said for this driving stretch
        this.iceSaid = false;
        this.fuelArmed = true;
        this.litres = null;
        this.range = null;
        this.minLitres = null;        // the lowest litres seen since the last refuel
        this.outsideC = null;
        this.history = [];            // [{event, at, why}] the last few, for the page
    }

    _emit(event, why) {
        if (EVENTS.indexOf(event) < 0) return false;
        if (!this.enabled(event)) { this.log('event ' + event + ' (' + why + '): apagado en los ajustes'); return false; }
        this.history.unshift({ event: event, at: this.now(), why: why });
        if (this.history.length > 8) this.history.length = 8;
        this.log('event ' + event + ': ' + why);
        this.say(event, { why: why, litres: this.litres, range: this.range, outside: this.outsideC });
        return true;
    }

    _welcome(why) {
        if (!this.welcomeArmed) return;
        this.welcomeArmed = false;
        this._emit('bienvenida', why);
    }

    condition(n) {
        if (!isNum(n)) return;
        const was = this.cond, t = this.now();
        if (n === was) return;
        this.cond = n;
        // nobody in the car any more: the next one to get in is welcomed
        if (n <= LEFT) this.welcomeArmed = true;
        // drive readiness starting, or drive-ready, without a door seen first (the head unit came up late)
        // (not when the app itself starts while the car is already drive-ready: a restart on the road)
        if ((n === 8 && (was === null || was < 8)) || (n === DRIVING && was !== null && was < 8)) this._welcome('el coche se prepara para arrancar');
        if (n === DRIVING && was !== DRIVING) {
            this.tripStart = t;
            this.iceSaid = false;
            if (this.stoppedAt !== null && t - this.stoppedAt >= this.cfg.stopResetsBreakMs) { this.driveMs = 0; this.breakSaid = 0; }
            this.stoppedAt = null;
        }
        if (was === DRIVING && n !== DRIVING) {
            const trip = this.tripStart !== null ? t - this.tripStart : 0;
            this.tripStart = null;
            this.stoppedAt = t;
            // drive readiness ending (12), or straight to ignition / off
            if (trip >= this.cfg.minTripMs) {
                this.tripEndAt = t;
                this.welcomeArmed = false;      // the driver opening the door to get out is not welcomed
                this._emit('fin_viaje', 'apagado tras ' + Math.round(trip / 60000) + ' min de viaje');
            }
        }
    }

    doors(list) {
        const open = Array.isArray(list) ? list.slice() : [];
        const opened = open.filter((d) => this.doorsOpen.indexOf(d) < 0);
        this.doorsOpen = open;
        if (opened.length && this.cond !== DRIVING) this._welcome('puerta abierta: ' + opened.join(', '));
    }

    fuel(litres, range) {
        if (isNum(litres)) {
            if (this.minLitres === null || litres < this.minLitres) this.minLitres = litres;
            if (litres - this.minLitres >= this.cfg.refuelLitres) {
                const from = this.minLitres;
                this.minLitres = litres;
                this.fuelArmed = true;
                this._emit('repostado', 'de ' + from + ' a ' + litres + ' L');
            }
            this.litres = litres;
        }
        if (isNum(range)) {
            this.range = range;
            if (range > this.cfg.fuelKm + this.cfg.fuelRearmKm) this.fuelArmed = true;
            if (this.fuelArmed && range <= this.cfg.fuelKm && this.cond === DRIVING) {
                this.fuelArmed = false;
                this._emit('combustible', 'autonomía ' + range + ' km');
            }
        }
    }

    outside(c) {
        if (!isNum(c)) return;
        this.outsideC = c;
        this._ice();
    }

    _ice() {
        if (this.iceSaid || this.cond !== DRIVING || !isNum(this.outsideC) || this.tripStart === null) return;
        if (this.now() - this.tripStart < this.cfg.iceAfterMs || this.outsideC > this.cfg.iceC) return;
        this.iceSaid = true;
        this._emit('hielo', 'fuera ' + this.outsideC + ' °C');
    }

    /** Every few seconds: the driving time for "descanso", the welcome back a while after a trip, the ice check. */
    tick() {
        const t = this.now();
        if (this.lastTick !== null && this.cond === DRIVING) this.driveMs += t - this.lastTick;
        this.lastTick = t;
        if (this.cond === DRIVING && this.driveMs >= this.cfg.breakMs * (this.breakSaid + 1)) {
            this.breakSaid++;
            this._emit('descanso', Math.round(this.driveMs / 60000) + ' min conduciendo');
        }
        if (!this.welcomeArmed && this.tripEndAt !== null && this.cond !== DRIVING && t - this.tripEndAt >= this.cfg.tripEndRearmMs) {
            this.welcomeArmed = true;
            this.tripEndAt = null;
        }
        this._ice();
    }

    /** What is kept across starts of the head unit (a refuel happens while it is off). */
    memo() { return { minLitres: this.minLitres, fuelArmed: this.fuelArmed }; }
    restore(m) {
        if (!m || typeof m !== 'object') return;
        if (isNum(m.minLitres)) this.minLitres = m.minLitres;
        if (typeof m.fuelArmed === 'boolean') this.fuelArmed = m.fuelArmed;
    }

    /** What the page shows. */
    state() {
        return { cond: this.cond, doors: this.doorsOpen.slice(), litres: this.litres, range: this.range, outside: this.outsideC,
            welcomeArmed: this.welcomeArmed, fuelArmed: this.fuelArmed, driveMin: Math.round(this.driveMs / 60000), history: this.history.slice() };
    }
}

module.exports = { Engine, EVENTS, DEFAULTS };
