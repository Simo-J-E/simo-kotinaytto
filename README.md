# Simo Kotinäyttö Canvas V5 – iPad Mini 2

Tämä versio on tehty vanhalle iPad Mini 2:lle, iOS 12.5.7:lle ja GitHub Pagesille. Koko näkymä piirretään yhdelle Canvas 2D -pinnalle. Sivulla ei käytetä Reactia, CSS Gridiä, Flex-asettelua tai palvelutyöntekijää.

Vanha iPad ei hae säätä tai sähkön hintaa suoraan ulkopuolisista palveluista. GitHub Actions hakee tiedot 15 minuutin välein ja tekee kevyen `data/latest.json`-tiedoston. iPad lataa vain tämän yhden tiedoston samasta osoitteesta kuin sivu. Jos verkkoyhteys katkeaa hetkeksi, viimeksi onnistuneet tiedot säilyvät iPadin muistissa.

## Päivitä nykyinen GitHub-sivu

1. Pura ZIP-tiedosto tietokoneella.
2. Avaa GitHubissa repository `simo-j-e/simo-kotinaytto`.
3. Valitse **Add file → Upload files**.
4. Lataa kaikki puretut tiedostot repositoryn juureen. Mukaan pitää tulla myös piilotettu `.github`-kansio sekä `data`- ja `scripts`-kansiot.
5. Valitse **Commit changes**.
6. Avaa **Settings → Pages** ja varmista, että kohdassa **Source** lukee **GitHub Actions**.
7. Avaa **Actions → Julkaise Simo Kotinaytto → Run workflow** ja käynnistä julkaisu kerran käsin.
8. Odota, että julkaisu muuttuu vihreäksi. Sivun osoite on `https://simo-j-e.github.io/simo-kotinaytto/`.

Työnkulku käyttää Node 24 -yhteensopivia GitHubin Actions-versioita. Vanhaa Node 20 -varoitusta ei pitäisi enää tulla.

## Päivitä vanha iPad

1. Avaa sivu ensin Safarissa osoitteella `https://simo-j-e.github.io/simo-kotinaytto/?canvas=5`.
2. Varmista, että oikeassa yläkulmassa lukee **V5 CANVAS**.
3. Jos vanha näkymä jää näkyviin, sulje aiempi Koti-valikon kotinäyttö, poista sen kuvake ja avaa linkki uudelleen Safarissa.
4. Paina **Jaa → Lisää Koti-valikkoon**.
5. Käytä iPadia vaakasuunnassa.

Sivu päivittää kellon jatkuvasti. Sää- ja sähkötiedosto tarkistetaan automaattisesti 15 minuutin välein, aina verkkoyhteyden palatessa ja aina kun sovellus avataan uudelleen.

Kun uusin versio on latautunut, oikeassa yläkulmassa lukee päivitysajan jälkeen **V5 CANVAS**. Canvas mittaa Safarin todellisen näkyvän leveyden ja korkeuden ja piirtää kaikki osat suoraan siihen kokoon.

## Sijainnin vaihtaminen

Sijainti on oletuksena Turku. Muuta tarvittaessa repositoryn `config.json`-tiedostosta nämä kolme kohtaa:

```json
{
  "location": "Turku",
  "latitude": 60.4518,
  "longitude": 22.2666,
  "timezone": "Europe/Helsinki"
}
```

Kun tallennat muutoksen GitHubiin, sivu julkaistaan automaattisesti uudelleen.

## Tietolähteet ja toimintavarmuus

- Sähkön hinta: ensisijaisesti Volton / Nord Pool, varalla Pörssisähkö.net.
- Sää: ensisijaisesti Open-Meteo, varalla MET Norway.
- Jos tietolähteet eivät vastaa, GitHub ei korvaa toimivaa sivua rikkinäisellä päivityksellä.
- Kuukausittainen ylläpitotyönkulku pitää julkisen repositoryn ajastetut GitHub Actions -työnkulut aktiivisina.
