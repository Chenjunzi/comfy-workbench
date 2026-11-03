export function stepResolution(width, height, direction, alignment = 8, maximum = 2048) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0)) return null
  const gcd = (a, b) => b ? gcd(b, a % b) : a
  const divisor = gcd(width, height)
  const unitWidth = width / divisor
  const unitHeight = height / divisor
  const increment = Math.max(1, Math.round(128 / (Math.max(unitWidth, unitHeight) * alignment))) * alignment
  const factor = direction > 0
    ? Math.floor(divisor / alignment) * alignment + increment
    : Math.ceil(divisor / alignment) * alignment - increment
  const next = { width: unitWidth * factor, height: unitHeight * factor }
  return Math.min(next.width, next.height) < 64 || Math.max(next.width, next.height) > maximum ? null : next
}
