// Curated shortcuts shown in Games > Apps. Launch URLs go through the same
// in-app launcher/proxy flow as game entries; icons use brand marks where available.
window.__VAULTED_APPS__ = [
  { id: "discord", name: "Discord", launch: "https://discord.com/app", img: "./assets/app-icons/discord.svg" },
  { id: "snapchat", name: "Snapchat", launch: "https://web.snapchat.com/", img: "./assets/app-icons/snapchat.svg" },
  { id: "vscode", name: "VS Code.dev", launch: "https://vscode.dev/", img: "./assets/app-icons/vscode.png" },
  { id: "netflix", name: "Netflix", launch: "https://www.netflix.com/", img: "./assets/app-icons/netflix.svg" },
  { id: "youtube", name: "YouTube", launch: "https://www.youtube.com/", img: "./assets/app-icons/youtube.svg" },
  { id: "x", name: "X / Twitter", launch: "https://x.com/", img: "./assets/app-icons/x.svg" },
  { id: "gmail", name: "Gmail", launch: "https://mail.google.com/", img: "./assets/app-icons/gmail.svg" },
  { id: "soundcloud", name: "SoundCloud", launch: "https://soundcloud.com/", img: "./assets/app-icons/soundcloud.svg" },
  { id: "pinterest", name: "Pinterest", launch: "https://www.pinterest.com/", img: "./assets/app-icons/pinterest.svg" },
  { id: "geforcenow", name: "GeForce NOW", launch: "https://play.geforcenow.com/", img: "./assets/app-icons/geforcenow.png" },
  { id: "telegram", name: "Telegram", launch: "https://web.telegram.org/", img: "./assets/app-icons/telegram.svg" },
  { id: "xbox-cloud", name: "Xbox Cloud Gaming", launch: "https://www.xbox.com/play", img: "./assets/app-icons/xbox-cloud.png" },
  { id: "poki", name: "Poki", launch: "https://poki.com/", img: "./assets/app-icons/poki.png" },
  { id: "chess", name: "Chess.com", launch: "https://www.chess.com/", img: "./assets/app-icons/chess.svg" },
  { id: "tiktok", name: "TikTok", launch: "https://www.tiktok.com/", img: "./assets/app-icons/tiktok.svg" },
  { id: "reddit", name: "Reddit", launch: "https://www.reddit.com/", img: "./assets/app-icons/reddit.svg" },
  { id: "pandora", name: "Pandora", launch: "https://www.pandora.com/", img: "./assets/app-icons/pandora.svg" },
  { id: "spotify", name: "Spotify", launch: "https://open.spotify.com/", img: "./assets/app-icons/spotify.svg" },
  { id: "crazygames", name: "CrazyGames", launch: "https://www.crazygames.com/", img: "./assets/app-icons/crazygames.png" },
  { id: "amazon", name: "Amazon", launch: "https://www.amazon.com/", img: "./assets/app-icons/amazon.png" },
  { id: "ebay", name: "eBay", launch: "https://www.ebay.com/", img: "./assets/app-icons/ebay.svg" },
  { id: "disneyplus", name: "Disney+", launch: "https://www.disneyplus.com/", img: "./assets/app-icons/disneyplus.png" },
  { id: "hulu", name: "Hulu", launch: "https://www.hulu.com/", img: "./assets/app-icons/hulu.png" },
  { id: "apple-music", name: "Apple Music", launch: "https://music.apple.com/", img: "./assets/app-icons/apple-music.svg" },
  { id: "crunchyroll", name: "Crunchyroll", launch: "https://www.crunchyroll.com/", img: "./assets/app-icons/crunchyroll.svg" },
  { id: "paramountplus", name: "Paramount+", launch: "https://www.paramountplus.com/", img: "./assets/app-icons/paramountplus.svg" },
  { id: "espn", name: "ESPN", launch: "https://www.espn.com/", img: "./assets/app-icons/espn.png" },
  { id: "peacock", name: "Peacock", launch: "https://www.peacocktv.com/", img: "./assets/app-icons/peacock.png" },
  { id: "bandlab", name: "BandLab", launch: "https://www.bandlab.com/", img: "./assets/app-icons/bandlab.svg" },
  { id: "fmhy", name: "FMHY.net", launch: "https://fmhy.net/", img: "./assets/app-icons/fmhy.png" },
  { id: "webtoon", name: "WEBTOON", launch: "https://www.webtoons.com/", img: "./assets/app-icons/webtoon.svg" },
  { id: "gofile", name: "GoFile", launch: "https://gofile.io/", img: "./assets/app-icons/gofile.png" }
 ].map(app => ({
  ...app,
  img: `https://www.google.com/s2/favicons?domain=${new URL(app.launch).hostname}&sz=128`
}));
