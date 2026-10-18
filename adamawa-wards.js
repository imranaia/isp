// The wards of every local government in Adamawa State: [ward code, ward name, number of polling units].
// From the campaign structure document ("Rufai Structure"), 226 wards in all. The codes and polling unit
// counts follow INEC's polling unit list (PUS.xlsx, see adamawa-pus.js).
// The local government names match ADAMAWA_LGAS in server.js. They are listed in the order of their
// INEC codes (Demsa 01 … Yola South 21), which db.js uses to build polling unit codes, so keep this order.

module.exports = {
  Demsa: [
    ["01", "Bille", 14], ["02", "Borrong", 14], ["03", "Demsa", 32], ["04", "Dili", 14], ["05", "Dong", 13],
    ["06", "Dwam", 16], ["07", "Gwamba", 11], ["08", "Kpasham", 26], ["09", "Mbula Kuli", 17], ["10", "Nassarawo Demsa", 20],
  ],
  Fufore: [
    ["01", "Beti", 22], ["02", "Farang", 27], ["03", "Fufore", 33], ["04", "Gurin", 38], ["05", "Harlahi", 20], ["06", "Mayo Ine", 30],
    ["07", "Pariya", 32], ["08", "Ribadu", 24], ["09", "Uki Tuki", 10], ["10", "Wuro Bokki", 25], ["11", "Tadim", 13],
  ],
  Ganye: [
    ["01", "Bakari Guso", 13], ["02", "Gamu", 10], ["03", "Ganye I", 33], ["04", "Ganye II", 28], ["05", "Gurum", 20],
    ["06", "Jaggu", 11], ["07", "Sangasumi", 20], ["08", "Sugu", 21], ["09", "Timdore", 23], ["10", "Yebbi", 19],
  ],
  Girei: [
    ["01", "Dakri", 13], ["02", "Damare", 13], ["03", "Girei I", 31], ["04", "Girei II", 16], ["05", "Gereng", 12],
    ["06", "Jera Bakari", 6], ["07", "Jera Bonyo", 8], ["08", "Modire/Viniklang", 24], ["09", "Tambo", 14], ["10", "Wuro Dole", 15],
  ],
  Gombi: [
    ["01", "Boga/Dingia", 18], ["02", "Duwa", 12], ["03", "Ga'anda", 15], ["04", "Gabun", 11], ["05", "Gombi North", 29],
    ["06", "Gombi South", 34], ["07", "Garkida", 19], ["08", "Guyaku", 17], ["09", "Tawa", 15], ["10", "Yang", 10],
  ],
  Gayuk: [
    ["01", "Banjiram", 10], ["02", "Bobinu", 12], ["03", "Bodgeno", 11], ["04", "Chikila", 26], ["05", "Dukul", 15],
    ["06", "Dumna", 15], ["07", "Guyuk", 28], ["08", "Kola", 15], ["09", "Lokoro", 9], ["10", "Purokyayo", 9],
  ],
  Hong: [
    ["01", "Bangshika", 25], ["02", "Daksiri", 17], ["03", "Garaha", 15], ["04", "Gaya", 21], ["05", "Hildi", 15], ["06", "Hong", 33],
    ["07", "Hushere Zum", 18], ["08", "Kwarhi", 11], ["09", "Mayo Lope", 12], ["10", "Shangui", 13], ["11", "Thilbang", 24], ["12", "Uba", 21],
  ],
  Jada: [
    ["01", "Danaba", 14], ["02", "Jada I", 30], ["03", "Jada II", 22], ["04", "Kima I", 18], ["05", "Kima II", 13], ["06", "Leko", 21],
    ["07", "Mapeo", 17], ["08", "Mayo Kalaye", 15], ["09", "Mbulu", 24], ["10", "Nyibango", 19], ["11", "Yelli", 22],
  ],
  Lamurde: [
    ["01", "Dubwangun", 11], ["02", "Gyawana", 20], ["03", "Lafiya", 21], ["04", "Lamurde", 21], ["05", "Mgbebongun", 7],
    ["06", "Bgbakowa", 12], ["07", "Opalo", 10], ["08", "Rigange", 9], ["09", "Suwa", 23], ["10", "Waduku", 18],
  ],
  Madagali: [
    ["01", "Babel", 8], ["02", "Duhu/Shuwa", 19], ["03", "Gulak", 31], ["04", "Hyambula", 12], ["05", "K/Wuro Nyayandi", 12],
    ["06", "Madagali", 24], ["07", "Pallam", 12], ["08", "Shelmi/Sukur/Vapu", 18], ["09", "Wagga", 18], ["10", "Wula", 6],
  ],
  Maiha: [
    ["01", "Belel", 17], ["02", "Humbutudi", 11], ["03", "Konkol", 10], ["04", "Maiha Gari", 10], ["05", "Manjekin", 11],
    ["06", "Mayonguli", 22], ["07", "Pakka", 11], ["08", "Sorau A", 9], ["09", "Sorau B", 12], ["10", "Tambajam", 9],
  ],
  "Mayo Belwa": [
    ["01", "Bajama", 10], ["02", "Binyeri", 13], ["03", "Gangfada", 14], ["04", "Gangle", 12], ["05", "Gorobi", 13], ["06", "Mayo Belwa", 51],
    ["07", "Mayo Farang", 22], ["08", "Nassarawo Jereng", 14], ["09", "Ndikong", 16], ["10", "Ribadu", 8], ["11", "Tola", 18], ["12", "Yoffo", 15],
  ],
  Michika: [
    ["01", "Bazza Margi", 12], ["02", "Futudou/Futules", 16], ["03", "Garta/Ghualchi", 9], ["04", "Jigalambu", 12], ["05", "Madiza", 15],
    ["06", "Michika I", 29], ["07", "Michika II", 19], ["08", "Mwkis/Wuro Ngiki", 14], ["09", "Moda/Olaka/Ghen", 14], ["10", "Munka Vicita", 6],
    ["11", "Swa/Kamale/Kwane", 15], ["12", "Thukudou/Sufuko", 18], ["13", "Sukumu/Tillijo", 16], ["14", "Tumbara/Vgarki", 6], ["15", "Vi/Boka", 10],
    ["16", "Wamblimi/Tilli", 12],
  ],
  "Mubi North": [
    ["01", "Bahuli", 13], ["02", "Betso", 13], ["03", "Digil", 12], ["04", "Kolere", 27], ["05", "Lokuwa", 43], ["06", "Mayo Bani", 15],
    ["07", "Mijilu", 18], ["08", "Muchala", 26], ["09", "Sabon Layi", 46], ["10", "Yimtim", 14], ["11", "Yelwa", 49],
  ],
  "Mubi South": [
    ["01", "Dirbish/Gandira", 7], ["02", "Duvu/Ihaba", 9], ["03", "Gella", 8], ["04", "Gude", 15], ["05", "Kwaja", 7],
    ["06", "Lamurde", 31], ["07", "Mujara", 14], ["08", "Mugulbu/Yadafa", 10], ["09", "Nassarawo", 33], ["10", "Nduku", 9],
  ],
  Numan: [
    ["01", "Bara", 10], ["02", "Bolki", 13], ["03", "Gamadio", 10], ["04", "Imburu", 25], ["05", "Kodomti", 13],
    ["06", "Numan I", 16], ["07", "Numan II", 16], ["08", "Numan III", 18], ["09", "Sabon Pegi", 38], ["10", "Vulpi", 11],
  ],
  Shelleng: [
    ["01", "Bakta", 6], ["02", "Bodwai", 13], ["03", "Gundo", 19], ["04", "Gwapopolok", 8], ["05", "Jumbul", 11],
    ["06", "Ketembere", 12], ["07", "Kiri", 9], ["08", "Libbo", 15], ["09", "Shelleng", 25], ["10", "Tallum", 6],
  ],
  Song: [
    ["01", "Dirma", 19], ["02", "Dumne", 24], ["03", "Gudu Mboi", 10], ["04", "Kilange Fung", 14], ["05", "Kilange Hirna", 10], ["06", "Sigire", 16],
    ["07", "Sukutu", 20], ["08", "Song Gari", 46], ["09", "Song Waje", 20], ["10", "Waltandi", 15], ["11", "Zuma", 13],
  ],
  Toungo: [
    ["01", "Dawo I", 9], ["02", "Dawo II", 10], ["03", "Gumti", 9], ["04", "Kiri I", 11], ["05", "Kiri II", 8],
    ["06", "Kongin Baba I", 5], ["07", "Kongin Baba II", 5], ["08", "Toungo I", 15], ["09", "Toungo II", 16], ["10", "Toungo III", 13],
  ],
  "Yola North": [
    ["01", "Alkalawa", 31], ["02", "Ajiya", 15], ["03", "Doubeli", 59], ["04", "Gwadabawa", 32], ["05", "Jambutu", 48], ["06", "Karewa", 60],
    ["07", "Limawa", 26], ["08", "Luggere", 28], ["09", "Nassarawo", 41], ["10", "Rumde", 15], ["11", "Yelwa", 22],
  ],
  "Yola South": [
    ["01", "Adarawo", 24], ["02", "Bako", 23], ["03", "Bole/Yolde Pate", 40], ["04", "Namtazi", 27], ["05", "Ngurore", 31], ["06", "Makama A", 30],
    ["07", "Makama B", 23], ["08", "Mba Mba", 22], ["09", "Mbamoi", 17], ["10", "Toungo", 20], ["11", "Yolde Kohi", 15],
  ],
};
