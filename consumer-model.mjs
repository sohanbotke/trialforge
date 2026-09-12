// Consumer-facing claims must be supported by reviewed catalog data.
export function isReviewed(offer) {
  return offer.verificationStatus === 'reviewed';
}

export function reviewedCost(offer, field = 'monthlyValue') {
  const cost = offer[field];
  return isReviewed(offer) && typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function reviewedFirst(a, b) {
  return Number(isReviewed(b)) - Number(isReviewed(a));
}

export function matchesConsumerFilters(offer, { maximum = '', review = 'all', type = 'all' } = {}) {
  if (review === 'reviewed' && !isReviewed(offer)) return false;
  // Starter type assertions have not been reviewed either.
  if (type !== 'all' && (!isReviewed(offer) || offer.offerType !== type)) return false;
  if (maximum !== '') {
    const cost = reviewedCost(offer);
    if (cost === null || cost > Number(maximum)) return false;
  }
  return true;
}

export function shortlistRecord(offer, { id, createdAt }) {
  return {
    id, catalogId: offer.id, service: offer.name,
    // Retained for compatibility; saved items are excluded from cost totals.
    monthlyValue: reviewedCost(offer) ?? 0,
    startDate: '', endDate: '', status: 'saved',
    goal: offer.goal || '', keepCriteria: '', checks: {}, createdAt
  };
}
