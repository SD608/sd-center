"use strict";

(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SDPlayerDamageResolver = api;
})(typeof globalThis !== "undefined" ? globalThis : null, function factory() {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function clonePlayerState(input = {}) {
    const maxHp = Number.isFinite(input.max_hp) ? Number(input.max_hp) : 100;
    const hp = Number.isFinite(input.hp) ? Number(input.hp) : maxHp;
    const armor = Number.isFinite(input.armor) ? Number(input.armor) : 0;
    const maxArmor = Number.isFinite(input.max_armor) ? Number(input.max_armor) : Math.max(0, armor);
    const laceration = Number.isFinite(input.laceration_percent) ? Number(input.laceration_percent) : 0;
    return {
      hp: clamp(hp, 0, maxHp),
      max_hp: Math.max(1, maxHp),
      armor: Math.max(0, armor),
      max_armor: Math.max(0, maxArmor),
      laceration_percent: clamp(laceration, 0, 100),
    };
  }

  function resolvePlayerHit(input = {}) {
    const before = clonePlayerState(input.player);
    const normalDamage = Number(input.normal_damage);
    if (!Number.isFinite(normalDamage) || normalDamage < 0) throw new RangeError("NORMAL_DAMAGE_MUST_BE_NONNEGATIVE");

    const response = input.response || {};
    const attack = input.attack || {};

    let nullifiedBy = null;
    if (response.evade_invulnerable === true) nullifiedBy = "EVADE_INVULNERABLE";
    else if (response.sword_parry === true && attack.sword_parry === true) nullifiedBy = "SWORD_PARRY";
    else if (response.greatsword_counter === true && attack.greatsword_counter === true) nullifiedBy = "GREATSWORD_COUNTER";

    if (nullifiedBy) {
      return {
        valid_hit: false,
        nullified_by: nullifiedBy,
        shield_guard_applied: false,
        normal_damage_before_guard: normalDamage,
        normal_damage_applied: 0,
        armor_damage: 0,
        hp_damage: 0,
        laceration_added_percent: 0,
        player_before: before,
        player_after: before,
      };
    }

    let appliedDamage = normalDamage;
    let shieldGuardApplied = false;
    if (response.shield_guard === true && attack.shield_guard === true && response.shield_in_front_arc === true) {
      shieldGuardApplied = true;
      if (Number.isFinite(attack.guarded_damage_normal)) {
        appliedDamage = Number(attack.guarded_damage_normal);
      } else {
        appliedDamage = normalDamage * 0.2;
      }
    }

    const armorDamage = Math.min(before.armor, appliedDamage);
    const hpDamage = Math.min(before.hp, Math.max(0, appliedDamage - armorDamage));
    const lacerationAdded = attack.laceration === true ? hpDamage : 0;

    const after = {
      ...before,
      armor: Math.max(0, before.armor - armorDamage),
      hp: Math.max(0, before.hp - hpDamage),
      laceration_percent: clamp(before.laceration_percent + lacerationAdded, 0, 100),
    };

    return {
      valid_hit: true,
      nullified_by: null,
      shield_guard_applied: shieldGuardApplied,
      normal_damage_before_guard: normalDamage,
      normal_damage_applied: appliedDamage,
      armor_damage: armorDamage,
      hp_damage: hpDamage,
      laceration_added_percent: lacerationAdded,
      external_direct_damage_timer_resets: (armorDamage + hpDamage) > 0,
      player_before: before,
      player_after: after,
    };
  }

  return Object.freeze({ clonePlayerState, resolvePlayerHit });
});
