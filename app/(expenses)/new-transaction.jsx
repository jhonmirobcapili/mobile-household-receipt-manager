import { View, Text, TouchableOpacity, ScrollView, Image, Alert, StyleSheet, ImageBackground, TextInput, BackHandler } from 'react-native'
import React, { useState, useEffect } from 'react'
import { icons } from "../../constants";
import { router } from "expo-router";
import { CustomButton, FormField } from "../../components";
import { addTransaction, uploadReciept } from '../../lib/firebase';
import categories from '../../constants/categories';
import { Modal } from "react-native-paper";
import { cleanAmount } from '../../constants/clearAmount';
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from "../../lib/firebase";

const dummyData ='';

const categorizeExpense = (input) => {
  const lowerCasedInput = input.toLowerCase();
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some((keyword) => lowerCasedInput.includes(keyword))) {
      return category;
    }
  }
  return 'Other';
};

const NewTransaction = () => {
  const [ user, setUser ] = useState(null);
  const [ loading, setLoading ] = useState(true);
  const [isSubmitting, setIsSubmitting ] = useState(false);
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [modelReceipt, setModelReceipt] = useState(false);
  const categoryTypes = Object.keys(categories);
  const [image, setImage] = useState(null);
  let receiptPath = "";
  const [predictions, setPredictions] = useState([]);

  useEffect(() => {
    const fetchUserData = async () => {
      setLoading(true);
      try {
        const userId = await AsyncStorage.getItem('userId');

        if (userId) {
          const userDocRef = doc(db, 'Users', userId);
          const unsubscribe = onSnapshot(userDocRef, (doc) => {
            if (doc.exists()) {
              setUser(doc.data());
            } else {
              handleLogout(); // Call logout if user data does not exist
            }
            setLoading(false);
          });

          return () => unsubscribe();
        } else {
          handleLogout();
        }
      } catch (error) {
        console.log(error);
        setLoading(false);
      }
    };

    fetchUserData();
  }, [setUser, setLoading]);

  const back = async () => {
    router.push("/view-expenses");
  };

  useEffect(() => {
    const backAction = () => {
      router.back(); // Go back to the previous screen
      return true; // Prevent default behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove(); // Cleanup the listener on unmount
  }, []);
  const handleCategorize = () => {
    const result = categorizeExpense(notes);
    
    setCategory(result);
  };

  const handleAddTransaction = async () => {
    setIsSubmitting(true);

    if (image !== null) {
      try {
        receiptPath = await uploadReciept(image);
      } catch (error) {
        setIsSubmitting(false);
        Alert.alert("Error",error.message);
        return;
      }
    }

    const newTransaction = {
        timestamp: formatDate(),
        notes: notes,
        amount: cleanAmount(amount),
        category: category,
        receiptPath: receiptPath
    };

    try {
      await addTransaction(user.userId, newTransaction);

      
      Alert.alert(
        'Confirmation',
        'Receipt added successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              router.push('/view-expenses');
            },
          },
        ]
      );
    } catch (error) {
      setIsSubmitting(false);
      Alert.alert("Error",error.message);
      return;
    }

    setIsSubmitting(false);
  };

  const pickImageGallery = async () => {
    setModelReceipt(false);
    let result =
      await ImagePicker.launchImageLibraryAsync({
          mediaTypes:
              ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          base64: true,
          allowsMultipleSelection: false,
      });
    if (!result.canceled) {
      performOCR(result.assets[0]);
      //parseData(dummyData);
      //setAmount(extractAmountNearTotal(dummyData));
      setImage(result.assets[0].uri);
    }
  };

  const pickImageCamera = async () => {
    setModelReceipt(false);
    let result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      base64: true,
      allowsMultipleSelection: false,
    });
    if (!result.canceled) {
      performOCR(result.assets[0]);
      setImage(result.assets[0].uri);
    }
  };

  const performOCR = (file) => {
    let myHeaders = new Headers();
    myHeaders.append(
        "apikey",
        
        // ADDD YOUR API KEY HERE 
        "H0F8p6v3eLpRbzbH5GPUOgE0ySF6u29t"  
    );
    myHeaders.append(
        "Content-Type",
        "multipart/form-data"
    );

    let raw = file;
    let requestOptions = {
        method: "POST",
        redirect: "follow",
        headers: myHeaders,
        body: raw,
    };

    // Send a POST request to the OCR API
    fetch(
        "https://api.apilayer.com/image_to_text/upload",
        requestOptions
    )
      .then((response) => response.json())
      .then((result) => {
        if (result["message"] && result["message"] === 'Image file too small')
        {
          Alert.alert("Error", result["message"] + ". Please try again!");
          return;
        }

        parseData(result["all_text"]);
        setAmount(extractAmountNearTotal(result["all_text"]));
      })
      .catch((error) => console.log("error", error));
  };

  const parseData = async (data) => {
    const parts = data.trim().split('\n');
    const items = [];

    for (let i = 0; i < parts.length; i++) {
        const hasKg = parts[i].includes('/kg') ? ' (contains /kg)' : '';

        if (hasKg === '') {
            items.push(parts[i]);
        }
    }

    setNotes(items.join('\n\n'));
    //console.log("item", notes);
    //const result = categorizeExpense(notes);

    const res = processReceipt(items.join('\n'));
    const most = getMostCommonCategory(res);
    
    setCategory(most);
    return items;
  };

  const formatDate = () => {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    };

    return new Date().toLocaleString('en-US', options);
  };

  const processReceipt = (notes) => {
    const itemLines = notes.trim().split('\n').map(line => line.trim().toLowerCase()).filter(line => line);
    const predictedItems = itemLines.map(item => ({
      item,
      predictedCategory: categorizeItem(item),
    }));

    const filteredResults = predictedItems.filter(result => result.predictedCategory);
    return filteredResults;
  };

  const categorizeItem = (item) => {
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => item.includes(keyword.toLowerCase()))) {
        return category;
      }
    }
    return null;
  };

  const getMostCommonCategory = (predictions) => {
    const counts = predictions.reduce((acc, curr) => {
      acc[curr.predictedCategory] = (acc[curr.predictedCategory] || 0) + 1;
      return acc;
    }, {});

    const mostCommon = Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
    return mostCommon[0] ? mostCommon[0] : 'Other';
  };

  function extractAmountNearTotal(text) {
    const parts = text.split(/\s+/);

    let totalIndex = -1;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].toLowerCase() === 'total amount sent' ||
            parts[i].toLowerCase() === 'total amount send' ||
            parts[i].toLowerCase() === 'total amount due' ||
            parts[i].toLowerCase() === 'total due' ||
            parts[i].toLowerCase() === 'total amount:' ||
            parts[i].toLowerCase() === 'total invoice' ||
            parts[i].toLowerCase() === 'total sale:' ||
            parts[i].toLowerCase() === 'total sale' ||
            parts[i].toLowerCase() === 'total:' ||
            parts[i].toLowerCase() === 'total') {
            totalIndex = i;
            break;
        }
    }

    if (totalIndex === -1) {
        Alert("Warning", "Make sure the receipt is crop well and not blug. Please try again");
        return [];
    }

    const validAmounts = [];
    const amountRegex = /[\$\d,]+(\.\d{2})?/;

    let amountBeforeTotal = null;
    let amountAfterTotal = null;

    for (let i = 0; i < totalIndex; i++) {
        const part = parts[i];
        const match = part.match(amountRegex);
        if (match) {
            validAmounts.push(cleanAmount(match[0]));
        }
    }

    for (let i = totalIndex + 1; i < parts.length; i++) {
        const part = parts[i];
        const match = part.match(amountRegex);
        if (match) {
            validAmounts.push(cleanAmount(match[0]));
        }
    }

    for (let i = totalIndex - 1; i >= 0; i--) {
        const part = parts[i];
        const match = part.match(amountRegex);
        if (match) {
            amountBeforeTotal = cleanAmount(match[0]);
            break;
        }
    }

    for (let i = totalIndex + 1; i < parts.length; i++) {
        const part = parts[i];
        const match = part.match(amountRegex);
        if (match) {
            amountAfterTotal = cleanAmount(match[0]);
            break;
        }
    }

    if (amountBeforeTotal === amountBeforeTotal)
      return amountBeforeTotal;
    else if (amountAfterTotal !== null || amountAfterTotal !== 0)
      return amountAfterTotal;
    else
      return amountBeforeTotal;
  }

  return (
    <View className="w-full h-full">
      <ScrollView className="p-5">
        <TouchableOpacity
          onPress={back}
          className="flex mt-5"
        >
          <Image
            source={icons.leftArrow}
            resizeMode="contain"
            className="w-6 h-6"
          />
        </TouchableOpacity>
        
        <Text className="font-pmedium text-lg mt-3 mb-5" style={{color: '#5E62AC', opacity: 100}}>
          Add Receipt
        </Text>

        <TouchableOpacity 
          className="w-full"
          onPress={() => setModelReceipt(true)}>
          <View>
            <View className="mb-2" style={{flexDirection: 'row'}}>
              <Text className="text-base font-pmedium">
                  Upload Reciept
              </Text>
            </View>
            
            <ImageBackground
              className="rounded-2xl flex"
              source={{ uri: image }}
              style={{
                width: '100%',
                height: 170,
                objectFit: "cover",
                backgroundColor: "black"
              }}
              resizeMode="cover">
                <View style={styles.overlay} className="h-full w-full flex justify-center items-center text-center">
                  <View className="w-14 h-14 border border-dashed border-secondary-100 flex justify-center items-center">
                    <Image
                        source={icons.upload}
                        resizeMode="contain"
                        alt="upload"
                        className="w-1/2 h-1/2"
                    />
                  </View>
                </View>
            </ImageBackground>
          </View>
        </TouchableOpacity>

        <View className="mt-5">
          { image === null ? (
            <FormField
              title='Note (Optional)'
              value={notes}
              handleChangeText={(e) => setNotes(e)}
              handleSubmit={handleCategorize}
              type="text"/>
          ) : (
            <View className="space-y-2">
              <Text className="text-base text-gray">Notes</Text>
              
              <View className="w-full px-4 rounded-2xl border-2 border-black-200 focus:border-primary flex flex-row items-center">
                <TextInput
                  style={styles.textarea}
                  value={notes}
                  onChangeText={(e) => setNotes(e)}
                  multiline
                  numberOfLines={4}
                  />
              </View>
            </View>
          )}

          <FormField
            title="Amount"
            otherStyles="mt-5"
            value={amount}
            handleChangeText={(e) => setAmount(e)}
            type="numeric"/>

          <View className="space-y-2 mt-5">
            <Text className="text-base text-gray font-pmedium">Categories</Text>
            <View style={{flexDirection: 'row'}}>
              <Text className="font-pmedium text-base" style={{color: 'gray', opacity: 100}}>
                {category === '' ? 'No selected category' : category}
              </Text>
              <Text className="font-pmedium text-base text-right" 
                style={{color: '#5E62AC', opacity: 100, flex: 1, textDecorationLine: 'underline',}}
                onPress={() => setModalVisible(true)}>
                select
              </Text>
            </View>
          </View>

          <CustomButton 
            title="SAVE"
            containerStyles="mt-20 mb-20"
            handlePress={handleAddTransaction}
            isLoading={isSubmitting}
          />
        </View>
      </ScrollView>

      <Modal transparent={true} animationType="fade" visible={modalVisible}>
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <TouchableOpacity className="w-full" style={{alignItems: 'flex-end'}} onPress={() => setModalVisible(false)}>
              <Image
                source={icons.close}
                resizeMode="contain"
                className="w-6 h-6"
              />
            </TouchableOpacity>
            <View style={{width: '100%', borderBottomColor: "#eee", borderBottomWidth: 1}} />
            {categoryTypes.map((item, index) => (
              <View className="w-full" key={index}>
                <TouchableOpacity className="p-3 w-full text-center" onPress={() => {setCategory(item); setModalVisible(false);}}>
                  <Text className="font-pmedium text-base" style={{color: 'black'}}>{item}</Text>
                </TouchableOpacity>
                <View style={{width: '100%', borderBottomColor: "#eee", borderBottomWidth: 1}} />
              </View>
            ))}
          </View>
        </View>
      </Modal>

      <Modal transparent={true} animationType="fade" visible={modelReceipt}>
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <TouchableOpacity className="w-full" style={{alignItems: 'flex-end'}} onPress={() => setModelReceipt(false)}>
              <Image
                source={icons.close}
                resizeMode="contain"
                className="w-6 h-6"
              />
            </TouchableOpacity>
            <View className="w-full text-left">
              <Text>Notes: Make sure your receipt want to scan or upload is clear and not blur.</Text>
            </View>
            <CustomButton title="Upload Receipt" handlePress={pickImageGallery} containerStyles="mt-5 w-full" />
            <CustomButton title="Capture Receipt" handlePress={pickImageCamera} containerStyles="mt-5 w-full" />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  modalBackground: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%', // Full width of the screen
    height: '100%',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContainer: {
    width: '100%',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    alignItems: 'center',
  },
  modalText: {
    fontSize: 18,
    marginBottom: 20,
  },
  textareaContainer: {
    height: 180,
    padding: 5,
    backgroundColor: 'white',
  },
  textarea: {
    textAlignVertical: 'top',  // hack android
    height: 170,
    fontSize: 14,
    color: 'black',
  },
});

export default NewTransaction;