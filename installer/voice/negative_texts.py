"""Neutrale deutsche Saetze, die beim Einrichten des persoenlichen Wake Words lokal mit Piper gesprochen werden.

Sie dienen nur als zusaetzliche Negativbeispiele (Alltagssprache ohne Wake Phrase) und enthalten keine echten
Personen, Firmen oder privaten Daten. `sentences_for` / `without_phrase_words` entfernen Saetze, in denen ein Wort der
gewaehlten Wake Phrase vorkommt - sonst wuerde die Phrase selbst als Negativbeispiel gelernt.
"""
import re
import unicodedata

_SKIP_WORDS = {"hey", "hallo", "okay", "hej"}   # Grussworte der Phrase zaehlen nicht als "Phrasenwort"

SENTENCES_DE = [
    "Heute Morgen habe ich lange geschlafen und dann in Ruhe gefruehstueckt.",
    "Kannst du bitte das Fenster schliessen, es zieht ein bisschen.",
    "Wir treffen uns um halb sieben vor dem Kino, die Karten habe ich schon.",
    "Im Kuehlschrank ist noch Milch, aber die Eier muessen wir nachkaufen.",
    "Der Zug hat zwanzig Minuten Verspaetung, das ist leider nichts Neues.",
    "Ich glaube, es wird heute Abend noch regnen, nimm lieber einen Schirm mit.",
    "Das Wochenende war ziemlich entspannt, wir waren nur im Park spazieren.",
    "Hast du schon gesehen, wie viel die Tomaten im Moment kosten?",
    "Morgen frueh muss ich zum Zahnarzt, danach gehe ich direkt ins Buero.",
    "Der neue Laden an der Ecke verkauft ziemlich gutes Brot und frische Broetchen.",
    "Lass uns am Samstag grillen, wenn das Wetter mitspielt.",
    "Die Besprechung wurde auf Mittwoch verschoben, weil zwei Leute krank sind.",
    "Ich habe den Schluessel auf den Tisch gelegt, damit du ihn nicht suchen musst.",
    "Meine Schwester faehrt naechste Woche in den Urlaub, sie freut sich schon sehr.",
    "Wir brauchen noch Nudeln, Tomatensauce und eine Packung Reis.",
    "Der Drucker im Flur geht schon wieder nicht, vielleicht ist das Papier alle.",
    "Bitte stell die Musik ein bisschen leiser, ich muss mich konzentrieren.",
    "Die Kinder spielen draussen im Garten und bauen eine kleine Huette.",
    "Gestern Abend lief ein sehr spannender Film, den ich dir unbedingt empfehlen kann.",
    "Hoffentlich ist der Parkplatz vor dem Haus noch frei, sonst muessen wir suchen.",
    "Er hat gesagt, dass er gleich kommt, aber das dauert bei ihm immer etwas laenger.",
    "Ich trinke morgens am liebsten einen starken Kaffee mit ein wenig Milch.",
    "Die Rechnung liegt noch auf dem Schreibtisch, ich kuemmere mich nachher darum.",
    "Im Sommer fahren wir meistens an die Ostsee, dort ist es nicht so voll.",
    "Das Radio laeuft den ganzen Tag, aber eigentlich hoert niemand richtig zu.",
    "Wenn du magst, kochen wir heute zusammen etwas Leichtes mit Gemuese.",
    "Die Heizung macht seit gestern ein komisches Geraeusch, ich sollte mal nachsehen.",
    "Am Montag beginnt die neue Woche, und es stehen einige Termine im Kalender.",
    "Ich habe das Buch fast durchgelesen, das Ende ist wirklich ueberraschend.",
    "Der Bus faehrt alle zehn Minuten, wir muessen uns also gar nicht beeilen.",
    "Koenntest du mir bitte das Salz reichen, das steht direkt neben dir.",
    "Die Nachbarn haben ein neues Auto, es ist blau und ziemlich gross.",
    "Ich muss noch Waesche waschen, sonst habe ich morgen nichts Sauberes mehr.",
    "Sie hat uns zum Geburtstag eingeladen, es gibt Kuchen und spaeter Pizza.",
    "Das Internet ist heute besonders langsam, vermutlich liegt es am Wetter.",
    "Wir haben den ganzen Tag gearbeitet und sind jetzt ziemlich muede.",
    "Kannst du mir kurz helfen, den Tisch ins Wohnzimmer zu tragen?",
    "Das Konzert war grossartig, besonders das letzte Lied hat mir gefallen.",
    "Ich habe vergessen, die Blumen zu giessen, hoffentlich sind sie nicht eingegangen.",
    "Im Supermarkt war es heute unglaublich voll, ich bin nach zehn Minuten wieder gegangen.",
    "Mein Handy hat nur noch zwanzig Prozent, ich suche mal das Ladekabel.",
    "Der Hund wartet schon an der Tuer, er will unbedingt nach draussen.",
    "Zum Mittagessen gibt es heute Suppe mit frischem Brot und einem kleinen Salat.",
    "Wir sollten bald einen Termin fuer die Autoinspektion ausmachen.",
    "Die Sonne scheint, also gehen wir am Nachmittag eine Runde an den See.",
    "Er arbeitet seit Jahren in derselben Firma und ist damit sehr zufrieden.",
    "Ich habe gestern ein altes Foto gefunden, auf dem wir noch ganz jung aussehen.",
    "Bitte denk daran, die Muelltonne rauszustellen, morgen frueh kommt die Abfuhr.",
    "Es ist erstaunlich, wie schnell die Zeit vergeht, wenn man viel zu tun hat.",
    "Wir haben uns fuer das gruene Sofa entschieden, es passt gut zu den Vorhaengen.",
    "Das Spiel gestern Abend ging unentschieden aus, aber es war sehr spannend.",
    "Vor dem Schlafen lese ich meistens noch ein paar Seiten in einem Roman.",
    "Der Kuchen ist im Ofen, in einer halben Stunde sollte er fertig sein.",
    "Ich wollte eigentlich frueher los, aber dann hat das Telefon geklingelt.",
    "Auf dem Markt gibt es heute besonders schoene Aepfel und frische Kraeuter.",
    "Die Praesentation fuer das Meeting ist fast fertig, es fehlen nur noch die Zahlen.",
    "Kannst du morgen die Kinder abholen, ich schaffe es leider nicht rechtzeitig?",
    "Wir koennen auch spaeter essen, ich habe noch keinen richtigen Hunger.",
    "Der Winter war lang, deshalb freuen sich alle auf die ersten warmen Tage.",
    "Ich habe mir ein neues Notizbuch gekauft, es hat einen schoenen blauen Einband.",
    "Gleich beginnt die Sendung, danach gehe ich noch kurz eine Runde laufen.",
    "Die Strasse ist wegen einer Baustelle gesperrt, wir muessen einen Umweg fahren.",
    "Er erzaehlt immer dieselben Geschichten, aber trotzdem hoert man gerne zu.",
    "Ich lerne gerade Gitarre, die ersten Akkorde klingen schon ganz ordentlich.",
    "Der Schnee ist ueber Nacht liegen geblieben, alles sieht ganz friedlich aus.",
    "Wenn es klappt, fahren wir im Herbst noch einmal in die Berge.",
    "Das Essen im Restaurant war gut, aber die Bedienung hat ziemlich lange gebraucht.",
    "Ich habe den Wecker auf sechs Uhr gestellt, damit wir den Zug nicht verpassen.",
    "Bitte schick mir die Unterlagen noch heute, ich brauche sie fuer morgen.",
    "Die Wohnung ist hell und ruhig, nur der Weg zur Arbeit ist etwas weit.",
    "Wir haben lange ueberlegt, aber jetzt steht der Plan fuer den naechsten Sommer.",
    "Das Kind hat heute zum ersten Mal ohne Stuetzraeder Fahrrad fahren koennen.",
    "Ich bin gespannt, was die anderen zu dem Vorschlag sagen werden.",
    "Der Tee ist noch heiss, lass ihn lieber ein paar Minuten abkuehlen.",
    "Meine Brille liegt bestimmt wieder irgendwo im Haus, ich finde sie nie.",
    "Wir haben am Abend noch lange auf dem Balkon gesessen und geredet.",
    "Im Moment passt es mir nicht so gut, koennen wir das spaeter besprechen?",
    "Die Zahlen fuer das letzte Quartal sehen insgesamt ganz ordentlich aus.",
    "Ein bisschen Bewegung am Morgen tut gut, auch wenn man erst nicht will.",
    "Ich habe alles vorbereitet, du musst nur noch den Tisch decken.",
    "Das Wasser im Pool ist noch ziemlich kalt, aber die Kinder stoert das nicht.",
    "Ruf mich bitte an, sobald du angekommen bist, damit ich Bescheid weiss.",
    "Die Kollegin aus dem zweiten Stock geht nach den Ferien in Rente.",
    "Hier ist es erstaunlich ruhig, man hoert nur ab und zu einen Vogel.",
    "Wir sollten den Keller aufraeumen, dort steht noch viel altes Zeug herum.",
    "Der Film dauert zwei Stunden, wir haben also genug Zeit fuer ein Abendessen davor.",
    "Mein Bruder hat ein neues Hobby gefunden und baut jetzt kleine Modelle aus Holz.",
    "Die Fahrkarte kostet etwas mehr als gedacht, dafuer ist sie einen ganzen Tag gueltig.",
    "Haben wir noch Batterien, die Fernbedienung reagiert kaum noch?",
    "Ich mag den Geruch von frisch gemaehtem Gras im Fruehling.",
    "Der Arzt hat gesagt, ich soll mehr trinken und ein bisschen mehr schlafen.",
    "Ploetzlich wurde es dunkel, und kurz darauf fing es kraeftig an zu regnen.",
    "Es war ein langer Tag, aber wir haben fast alles geschafft, was wir uns vorgenommen hatten.",
    "Der Kellner hat uns einen Tisch am Fenster gegeben, mit Blick auf den Fluss.",
    "Wir haben die Karten fuer das Theater schon vor Wochen gekauft.",
    "Im Garten bluehen gerade die ersten Tulpen und die Narzissen.",
    "Kannst du dir vorstellen, dass das Haus schon ueber hundert Jahre alt ist?",
    "Er spricht drei Sprachen fliessend und lernt gerade eine vierte.",
    "Morgen frueh faengt die Schule wieder an, und die Taschen sind noch nicht gepackt.",
    "Die Tomatenpflanzen auf dem Balkon tragen dieses Jahr besonders viele Fruechte.",
    "Ich habe die Wanderschuhe schon an die Tuer gestellt, damit ich sie nicht vergesse.",
    "Zwischen den Terminen bleibt kaum Zeit, um etwas Vernuenftiges zu essen.",
    "Die Pfanne ist noch heiss, fass sie bitte nicht ohne Topflappen an.",
    "Es gibt neue Regeln fuer die Muelltrennung, ich muss das mal in Ruhe nachlesen.",
    "Zuerst rechnen wir das Budget durch, dann entscheiden wir ueber die Anschaffung.",
    "Das Licht im Flur flackert, vermutlich ist die Lampe bald kaputt.",
    "Ich habe mich nach dem langen Spaziergang wunderbar erholt und gut geschlafen.",
    "Auf dem Weg nach Hause habe ich noch schnell Blumen und etwas Obst besorgt.",
    "Fuenf mal sieben ist fuenfunddreissig, und dreissig plus zwoelf ergibt zweiundvierzig.",
]


def _fold(word: str) -> str:
    text = unicodedata.normalize("NFKD", word.lower().replace("ß", "ss"))
    return "".join(c for c in text if "a" <= c <= "z")


def phrase_words(phrase: str) -> set:
    """Gefaltete Woerter der Phrase (a-z, Mindestlaenge 3, ohne Grussworte); Bindestrich-Woerter zaehlen mit Teilen."""
    words = set()
    for raw in re.findall(r"[^\W\d_]+", phrase or ""):
        word = _fold(raw)
        if len(word) >= 3 and word not in _SKIP_WORDS:
            words.add(word)
    return words


def _contains(text: str, words: set) -> bool:
    return any(_fold(w) in words for w in re.findall(r"[^\W\d_]+", text))


def without_phrase_words(texts: list, phrase: str) -> list:
    """Behaelt je Text nur die Saetze ohne Wort der Phrase. Bleibt von einem Text nichts uebrig, steht ein neutraler
    Satz an seiner Stelle: die Laenge der Liste bleibt gleich."""
    words = phrase_words(phrase)
    if not words:
        return list(texts)
    clean = [s for s in SENTENCES_DE if not _contains(s, words)]
    out = []
    for i, text in enumerate(texts):
        kept = [s for s in re.split(r"(?<=[.!?])\s+", text) if not _contains(s, words)]
        out.append(" ".join(kept) if kept else (clean[i % len(clean)] if clean else text))
    return out


def sentences_for(phrase: str) -> list:
    """Neutrale Saetze fuer das Training, ohne Wort der Wake Phrase."""
    words = phrase_words(phrase)
    return [s for s in SENTENCES_DE if not _contains(s, words)] if words else list(SENTENCES_DE)
