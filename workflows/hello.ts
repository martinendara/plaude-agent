async function sayHello() {
  "use step";

  return "hello";
}

export async function helloWorkflow() {
  "use workflow";

  return await sayHello();
}
