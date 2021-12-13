export async function delay(time: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}
