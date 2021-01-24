export async function delay(time: number) {
  await new Promise((resolve, reject) => {
    setTimeout(resolve, time);
  });
}
