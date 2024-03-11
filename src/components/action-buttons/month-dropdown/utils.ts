export const getScrollAreaHeight = (months: number) => {
  switch (months) {
    case 2: return 'h-16'
    case 3: return 'h-24'
    case 4: return 'h-32'
    case 5: return 'h-40'
    case 6: return 'h-48'
    case 7: return 'h-56'
    case 8: return 'h-64'
    default: return 'h-72'
  }
}