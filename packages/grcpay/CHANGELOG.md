# [grcpay-v1.1.2](https://github.com/gridcat/grcpay/compare/grcpay-v1.1.1...grcpay-v1.1.2) (2026-09-29)


### Bug Fixes

* clear the production audit for grcpay (yayson 4, joi, morgan, qs) ([fd6e307](https://github.com/gridcat/grcpay/commit/fd6e3076a66031052fd64e5a814b07289d56f4ab))
* confine refunds to confirmed txs and harden secrets/limits ([f6fe31c](https://github.com/gridcat/grcpay/commit/f6fe31c0fde8412a360977253725301814bf2de5))
* dependencies tree ([f9c19ba](https://github.com/gridcat/grcpay/commit/f9c19baea4950ecaa0aa5685447f2b9fb837686a))
* fetch GRC quotes from CoinGecko's coin endpoint, optionally with a Demo key ([3f6f57f](https://github.com/gridcat/grcpay/commit/3f6f57f8edc321f1308293ecd7ae6ccf4994ecb5))
* remove residue ([474e969](https://github.com/gridcat/grcpay/commit/474e969e9371ba33738826e08b03188d49254c14))
* serve cached rates through CoinGecko outages and report feed health on /status ([5720bce](https://github.com/gridcat/grcpay/commit/5720bceff5bcc786c936c14e24f6577eaea40ea1))
* wait for the money to became mature before spending ([5560085](https://github.com/gridcat/grcpay/commit/5560085bd77f1262e5c7473f44216a0855127597))
* wallet status ([54a59fb](https://github.com/gridcat/grcpay/commit/54a59fbd8def234f1da7f52a071e2d0f43e1baf0))

# [grcpay-v1.1.1](https://github.com/gridcat/grcpay/compare/grcpay-v1.1.0...grcpay-v1.1.1) (2026-05-29)


### Bug Fixes

* adddress integrations test issue ([9166606](https://github.com/gridcat/grcpay/commit/91666060075c9deea8f6eaf6cb485b79bf41a1f9))
* prevent already spent issue ([7f08316](https://github.com/gridcat/grcpay/commit/7f0831605e47fe19b241f866b0f26b236caaef5a))

# [grcpay-v1.1.0](https://github.com/gridcat/grcpay/compare/grcpay-v1.0.0...grcpay-v1.1.0) (2026-05-26)


### Bug Fixes

* a lot of bugfixes ([b26d7de](https://github.com/gridcat/grcpay/commit/b26d7de335522d5161702eb96247c81753c33197))
* fix duplicated import ([3dd7b3f](https://github.com/gridcat/grcpay/commit/3dd7b3f68eb1224cc0752712ee7d45dd8e007b6d))
* fix ts issue ([fe5365e](https://github.com/gridcat/grcpay/commit/fe5365e3fac62fbffc650470daf361d908053216))


### Features

* outbound webhooks, crash-safe broadcasts, cancel-with-funds ([7e8d759](https://github.com/gridcat/grcpay/commit/7e8d75966530817f726779aa2be072dd105b761a))

# grcpay-v1.0.0 (2026-05-10)


### Features

* initial commit ([47ca411](https://github.com/gridcat/grcpay/commit/47ca41125bf8f64b17fee6398166a397927802c5))
* recreate infrastructure ([09ea4ba](https://github.com/gridcat/grcpay/commit/09ea4ba8a8695c91ff6ba88542556ded7959fbf5))
