let provider;
const output = document.getElementById("output");
window.addEventListener("eip6963:announceProvider", (event) => {
  if (event.detail.info.rdns === "io.madagamask.wallet") {
    provider = event.detail.provider;
    provider.on("accountsChanged", (accounts) => {
      output.textContent = `Accounts changed: ${JSON.stringify(accounts)}`;
    });
    provider.on("chainChanged", (chain) => {
      output.textContent = `Chain changed: ${chain}`;
    });
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
async function account() {
  return (await provider.request({ method: "eth_accounts" }))[0];
}
const actions = {
  connect: () => provider.request({ method: "eth_requestAccounts" }),
  accounts: () => provider.request({ method: "eth_accounts" }),
  chain: () => provider.request({ method: "eth_chainId" }),
  sign: async () =>
    provider.request({
      method: "personal_sign",
      params: ["0x4d61646167616d61736b2074657374", await account()],
    }),
  typed: async () =>
    provider.request({
      method: "eth_signTypedData_v4",
      params: [
        await account(),
        JSON.stringify({
          domain: {
            name: "Madagamask test",
            version: "1",
            chainId: Number(await provider.request({ method: "eth_chainId" })),
          },
          types: { Greeting: [{ name: "message", type: "string" }] },
          primaryType: "Greeting",
          message: { message: "Disposable test only" },
        }),
      ],
    }),
  switch: () =>
    provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    }),
  send: async () =>
    provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: await account(),
          to: document.getElementById("recipient").value,
          value: "0xe8d4a51000",
        },
      ],
    }),
};
for (const [id, action] of Object.entries(actions))
  document.getElementById(id).addEventListener("click", async () => {
    try {
      if (!provider)
        throw new Error("Load the extension and reload this page.");
      output.textContent = "Waiting for wallet…";
      output.textContent = JSON.stringify(await action(), null, 2);
    } catch (error) {
      output.textContent = error.message;
    }
  });
