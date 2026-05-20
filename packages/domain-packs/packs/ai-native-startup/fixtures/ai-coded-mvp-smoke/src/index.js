export function activationEvent(user) {
  return {
    type: "activation",
    userId: user.id,
    createdAt: new Date(0).toISOString()
  };
}
