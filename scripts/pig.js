let isPigActive = false;  // Game is inactive by default

Hooks.once("ready", () => {
  Hooks.on("createChatMessage", async (chatMessage, options, userId) => {
    const message = chatMessage.content?.trim();

    if(!message) return;

    if (message.startsWith("!startpig")) {
      await chatMessage.delete();
      await startPigGame();
      return false;
    }
    
    if (message.startsWith("!rollpig")) {
      await handleRollMultipleDice(chatMessage.speaker, 1, chatMessage);
      return false;
    }
    if (message.startsWith("!holdpig")) {
      await handleHoldPig(chatMessage.speaker);
      await chatMessage.delete();
      return false;
    }
    if (message.startsWith("!resetpig")) {
      await resetPigGame();
      await chatMessage.delete();
      return false;
    }
    if (message.startsWith("!rolldicepig")) {
      const parts = message.trim().split(" ");
      const numDice = parseInt(parts[1]) || 1;
      if (numDice < 1) {
        await handleRollMultipleDice(chatMessage.speaker, 1, chatMessage);
        return false;
      }
      await handleRollMultipleDice(chatMessage.speaker, numDice, chatMessage);
      return false;
    }
  });
});

Hooks.on("updateCombat", async (combat, changed, options, userId) => {
  if(isPigActive){
    if (changed.turn !== undefined) {
      const currentCombatant = combat.combatant;
      const currentActor = currentCombatant?.actor;
      if (!currentActor) return;
      let state = currentActor.getFlag("world", "pigGame") ?? { totalScore: 0, turnScore: 0, isHolding: false };
      state.isHolding = false;
      await currentActor.setFlag("world", "pigGame", state);

      ChatMessage.create({
        content: `👉 It's now <b>${currentActor.name}</b>'s turn!`,
        speaker: ChatMessage.getSpeaker({ user: game.user })
      });
    }
  }
});

async function startPigGame() {
  isPigActive = true;

  await resetPigGame(false, false); // Reset everyone, but don't deactivate and don't display

  ChatMessage.create({
    content: `<b>🐷 Pig Game has started!</b><br>Type <code>!rollpig</code> to begin playing.`,
    speaker: { alias: "🐷 Master Oinkers" }
  });

  // 🔥 Check if combat is active and announce the current turn
  const combat = game.combat;
  if (combat && combat.started && combat.combatant) {
    const currentCombatant = combat.combatant;
    const currentActor = currentCombatant.actor;
    if (currentActor) {
      ChatMessage.create({
        content: `👉 It's now <b>${currentActor.name}</b>'s turn!`,
        speaker: { alias: "🐷 Master Oinkers" }
      });
    }
  }
}

async function handleRollMultipleDice(speaker, numDice, messageToDelete) {
  const combat = game.combat;
  if (!combat?.combatant) return ui.notifications.warn("No active combat.");


  const currentCombatant = combat.combatant;
  const currentActor = currentCombatant.actor;
  const userActor = game.actors.get(speaker.actor);

  if (!userActor || currentActor.id !== userActor.id) {
    return ui.notifications.warn(`It's not your turn!`);
  }

  let state = currentActor.getFlag("world", "pigGame") ?? { totalScore: 0, turnScore: 0, isHolding: false };

  if (state.isHolding) {
    return ui.notifications.warn(`${currentActor.name} has already held this turn!`);
  }

  const rollFormula = `${numDice}d6`;
  const roll = await new Roll(rollFormula).roll({ async: true });
  await roll.toMessage({ flavor: `🎲 ${numDice} Dice Roll for ${currentActor.name}`, speaker: { actor: currentActor.id } });
  

  const hasOne = roll.terms[0].results.some(r => r.result === 1);
  
  messageToDelete.delete();
  //bad sleep change it to longer or shorter if you want for dice is nice.
  await new Promise(resolve => setTimeout(resolve, 2000));

  if (hasOne) {
    state.turnScore = 0;
    state.isHolding = false;
    await currentActor.setFlag("world", "pigGame", state);
    ChatMessage.create({
      content: `<b>${currentActor.name} rolled a 1 and busted!</b><br>Total score stays at ${state.totalScore}.`,
      speaker: { alias: "🐷 Master Oinkers" }
    });

    await displayLeaderboard();
    await combat.nextTurn();
  } else {
    const rollTotal = roll.total;
    state.turnScore += rollTotal;
    await currentActor.setFlag("world", "pigGame", state);
    ChatMessage.create({
      content: `<b>${currentActor.name} rolled ${numDice} dice totaling ${rollTotal}.</b><br>Turn score: ${state.turnScore}<br>Total if held: ${state.totalScore + state.turnScore}`,
      speaker: { alias: "🐷 Master Oinkers" }
    });

    if (state.totalScore + state.turnScore >= 100) {
      state.totalScore += state.turnScore;
      state.turnScore = 0;
      state.isHolding = true;
      await currentActor.setFlag("world", "pigGame", state);

      ChatMessage.create({
        content: `<b>${currentActor.name} has won the Pig Game with ${state.totalScore} points!</b><br>🎉 Congratulations! 🎉`,
        speaker: { alias: "🐷 Master Oinkers" }
      });

      await displayLeaderboard();
      await resetPigGame(true, true);
      isPigActive = false;
    }
  }
}

async function handleHoldPig(speaker) {

  if (!isPigActive) {
    return ui.notifications.warn(`The Pig Game hasn't started yet. Type !startpig to begin.`);
  }  

  const combat = game.combat;
  if (!combat?.combatant) return ui.notifications.warn("No active combat.");
  const currentCombatant = combat.combatant;
  const currentActor = currentCombatant.actor;
  const userActor = game.actors.get(speaker.actor);

  if (!userActor || currentActor.id !== userActor.id) {
    return ui.notifications.warn(`It's not your turn!`);
  }

  let state = currentActor.getFlag("world", "pigGame") ?? { totalScore: 0, turnScore: 0, isHolding: false };

  if (state.isHolding) {
    return ui.notifications.warn(`${currentActor.name} already held this turn!`);
  }

  state.totalScore += state.turnScore;
  state.turnScore = 0;
  state.isHolding = true;
  await currentActor.setFlag("world", "pigGame", state);

  ChatMessage.create({
    content: `<b>${currentActor.name} holds.</b><br>Banked points. New total: ${state.totalScore}`,
    speaker: { alias: "🐷 Master Oinkers" }
  });

  await displayLeaderboard();
  await combat.nextTurn();
}

async function resetPigGame(deactivate = true, displayResetMessage = true) {
  const combatants = game.combat?.combatants ?? [];
  for (const combatant of combatants) {
    const actor = combatant.actor;
    await actor.setFlag("world", "pigGame", { totalScore: 0, turnScore: 0, isHolding: false });
  }

  if (deactivate) {
    isPigActive = false;
  }  

  if(displayResetMessage){
    ChatMessage.create({
      content: `<b>🐷 Pig Game has been reset${deactivate ? " and ended" : ""}!</b><br>All scores have been cleared.`,
      speaker: { alias: "🐷 Master Oinkers" }
    });
  }
}

async function displayLeaderboard() {
  const combatants = game.combat?.combatants ?? [];
  if (combatants.length === 0) return;

  const scores = [];
  for (const combatant of combatants) {
    const actor = combatant.actor;
    const state = actor.getFlag("world", "pigGame") ?? { totalScore: 0 };
    scores.push({ name: actor.name, score: state.totalScore });
  }

  scores.sort((a, b) => b.score - a.score);

  const leaderboard = scores
    .map((s, i) => `<b>#${i + 1}</b> - ${s.name}: ${s.score} points`)
    .join("<br>");

  ChatMessage.create({
    content: `<b>🏆 Current Leaderboard:</b><br>${leaderboard}`,
    speaker: ChatMessage.getSpeaker({ user: game.user })
  });
}
