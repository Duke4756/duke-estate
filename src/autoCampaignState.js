// Status polling must only refresh fields owned by the running scheduler.
// Form settings may contain unsaved user edits and must remain untouched.
export function mergeAutoCampaignRuntime(current, serverCampaign) {
  if (!current) return serverCampaign
  if (!serverCampaign) return current

  return {
    ...current,
    accountState: serverCampaign.accountState ?? current.accountState,
    rotationState: serverCampaign.rotationState ?? current.rotationState,
  }
}
