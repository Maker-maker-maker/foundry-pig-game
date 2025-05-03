Hooks.once("ready", () => {
  Hooks.on("chatMessage", async (chatLog, message, chatData) => {
    if (message.startsWith("/rollpig")) {
      await handleRollPig(chatData.speaker);
      return false;
    }
    if (message.startsWith("/holdpig")) {
      await handleHoldPig(chatData.speaker);
      return false;
    }
    if (message.startsWith("/resetpig")) {
      await resetPigGame();
      return false;
    }
  });
});

async function handleRollPig(speaker) {
  const combat = game.combat;
  if (!combat?.combatant) return ui.notifications.warn("No active combat.");
  const currentCombatant = combat.combatant;
  const currentActor = currentCombatant.actor;
  const userActor = game.actors.get(speaker.actor);

  // Enforce that it's the player's turn
  if (!userActor || currentActor.id !== userActor.id) {
    return ui.notifications.warn(`It's not your turn!`);
  }

  let state = currentActor.getFlag("world", "pigGame") ?? { totalScore: 0, turnScore: 0, isHolding: false };

  if (state.isHolding) {
    return ui.notifications.warn(`${currentActor.name} has already held this turn!`);
  }

  // Roll a die
  const roll = await new Roll("1d6").roll({ async: true });
  await roll.toMessage({ flavor: `🎲 Pig Dice Roll for ${currentActor.name}` });

  if (roll.total === 1) {
    state.turnScore = 0;
    state.isHolding = false;  // Reset holding state if busted
    await currentActor.setFlag("world", "pigGame", state);
    ChatMessage.create({
      content: `<b>${currentActor.name} rolled a 1 and busted!</b><br>Total score stays at ${state.totalScore}.`,
      speaker: { actor: currentActor }
    });
    await combat.nextTurn(); // Move to next player
  } else {
    state.turnScore += roll.total;
    await currentActor.setFlag("world", "pigGame", state);
    ChatMessage.create({
      content: `<b>${currentActor.name} rolled a ${roll.total}.</b><br>Turn score: ${state.turnScore}<br>Total if held: ${state.totalScore + state.turnScore}`,
      speaker: { actor: currentActor }
    });

    // Check if the player has won (reached 100 points)
    if (state.totalScore + state.turnScore >= 100) {
      state.totalScore += state.turnScore;
      state.turnScore = 0;
      state.isHolding = true; // Automatically hold when winning
      await currentActor.setFlag("world", "pigGame", state);

      ChatMessage.create({
        content: `<b>${currentActor.name} has won the Pig Game with ${state.totalScore} points!</b><br>Congratulations!`,
        speaker: { actor: currentActor }
      });

      // Reset the game after a win
      await resetPigGame();
    }
  }
}

async function handleHoldPig(speaker) {
  const combat = game.combat;
  if (!combat?.combatant) return ui.notifications.warn("No active combat.");
  const currentCombatant = combat.combatant;
  const currentActor = currentCombatant.actor;
  const userActor = game.actors.get(speaker.actor);

  // Enforce that it's the player's turn
  if (!userActor || currentActor.id !== userActor.id) {
    return ui.notifications.warn(`It's not your turn!`);
  }

  let state = currentActor.getFlag("world", "pigGame") ?? { totalScore: 0, turnScore: 0, isHolding: false };

  // If already holding, prevent holding again
  if (state.isHolding) {
    return ui.notifications.warn(`${currentActor.name} already held this turn!`);
  }

  // Update scores and mark as held
  state.totalScore += state.turnScore;
  state.turnScore = 0;
  state.isHolding = true; // Mark the turn as held
  await currentActor.setFlag("world", "pigGame", state);

  ChatMessage.create({
    content: `<b>${currentActor.name} holds.</b><br>Banked points. New total: ${state.totalScore}`,
    speaker: { actor: currentActor }
  });

  await combat.nextTurn(); // End the current turn and move to next player
}

async function resetPigGame() {
  // Clear scores for all players
  const combatants = game.combat?.combatants ?? [];
  for (const combatant of combatants) {
    const actor = combatant.actor;
    await actor.setFlag("world", "pigGame", { totalScore: 0, turnScore: 0, isHolding: false });
  }

  // Notify players
  ChatMessage.create({
    content: `<b>Pig Game has been reset!</b><br>All scores have been cleared.`,
    speaker: ChatMessage.getSpeaker({ user: game.user })
  });
}
