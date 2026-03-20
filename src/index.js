function add(a, b) {
  const result = a + b
  return result
}

function multiply(a, b) {
  const product = a * b
  return product
}

function main() {
  const total = add(20, 22)
  const doubled = multiply(total, 2)
  console.log('computed value', doubled)
}

main()
